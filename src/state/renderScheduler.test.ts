import { describe, expect, it, vi } from 'vitest'
import { createPainting } from '../domain/library.ts'
import { createEditLayer } from '../imaging/edits.ts'
import { createRaster, type Raster } from '../imaging/raster.ts'
import type { RenderMessage, RenderReply, RenderRequest } from '../workers/protocol.ts'
import { createRenderScheduler, type RenderJob, type RenderPort } from './renderScheduler.ts'

/** A worker stand-in: records what it is sent; the test replies when it wants. */
function fakePort() {
  const sent: RenderMessage[] = []
  const port: RenderPort & { sent: RenderMessage[]; reply(r: RenderReply): void } = {
    sent,
    onReply: null,
    post(message) {
      sent.push(message)
    },
    reply(r) {
      port.onReply?.(r)
    },
  }
  return port
}

const spec = createPainting(
  { title: 'Job', width: 1, height: 1, pixelsPerBlock: 4 },
  new Date(0),
  () => 0.5,
)
const picture = createRaster(8, 8, [1, 2, 3, 255])
const job = (patch: Partial<RenderJob> = {}): RenderJob => ({
  spec,
  source: picture,
  edits: null,
  prefetch: false,
  ...patch,
})
const raster = (fill: number): Raster => createRaster(4, 4, [fill, fill, fill, 255])
const rendered = (id: number, fill = id): RenderReply => ({
  kind: 'rendered',
  id,
  raster: raster(fill),
  transparent: 0,
})
const lastRender = (port: { sent: RenderMessage[] }) => port.sent.at(-1) as RenderRequest

function setup() {
  const port = fakePort()
  const onRendered = vi.fn()
  const onFailed = vi.fn()
  const scheduler = createRenderScheduler(port, { rendered: onRendered, failed: onFailed })
  return { port, scheduler, onRendered, onFailed }
}

describe('render scheduler', () => {
  it('sends a request at once when the worker is free, with the picture and edits', () => {
    const { port, scheduler } = setup()
    const edits = createEditLayer(4, 4)
    scheduler.request(job({ edits }))
    expect(port.sent).toHaveLength(1)
    expect(lastRender(port)).toMatchObject({ kind: 'render', id: 1, source: picture, edits })
  })

  it('keeps at most one request waiting: the latest wins', () => {
    const { port, scheduler, onRendered } = setup()
    scheduler.request(job())
    const second = job({ spec: { ...spec, id: 'second' } })
    const third = job({ spec: { ...spec, id: 'third' } })
    scheduler.request(second)
    scheduler.request(third)
    expect(port.sent).toHaveLength(1)
    port.reply(rendered(1))
    // The busy worker's result still shows (it is newer than the screen); then the latest goes.
    expect(onRendered).toHaveBeenCalledTimes(1)
    expect(port.sent).toHaveLength(2)
    expect(lastRender(port).spec.id).toBe('third')
    port.reply(rendered(2))
    expect(onRendered).toHaveBeenLastCalledWith(
      expect.objectContaining({ job: third, raster: raster(2) }),
    )
    expect(port.sent).toHaveLength(2)
  })

  it('sends a picture or an edit layer only when it changed', () => {
    const { port, scheduler } = setup()
    scheduler.request(job())
    port.reply(rendered(1))
    scheduler.request(job({ spec: { ...spec, id: 'other' } }))
    expect(lastRender(port)).not.toHaveProperty('source')
    expect(lastRender(port)).not.toHaveProperty('edits')
    port.reply(rendered(2))
    const next = createRaster(2, 2)
    const edits = createEditLayer(4, 4)
    scheduler.request(job({ source: next, edits }))
    expect(lastRender(port)).toMatchObject({ source: next, edits })
    port.reply(rendered(3))
    scheduler.request(job({ source: null, edits }))
    expect(lastRender(port)).toHaveProperty('source', null)
    expect(lastRender(port)).not.toHaveProperty('edits')
  })

  it('drops replies to forgotten requests and resends the picture afterwards', () => {
    const { port, scheduler, onRendered } = setup()
    scheduler.request(job())
    scheduler.request(job({ spec: { ...spec, id: 'waiting' } }))
    scheduler.forget()
    expect(port.sent.at(-1)).toEqual({ kind: 'forget' })
    port.reply(rendered(1))
    expect(onRendered).not.toHaveBeenCalled()
    // Nothing was waiting any more.
    expect(port.sent).toHaveLength(2)
    scheduler.request(job())
    expect(lastRender(port)).toMatchObject({ id: 2, source: picture })
    port.reply(rendered(2))
    expect(onRendered).toHaveBeenCalledTimes(1)
  })

  it('ignores replies it is not waiting for', () => {
    const { port, scheduler, onRendered } = setup()
    scheduler.request(job())
    port.reply(rendered(7))
    expect(onRendered).not.toHaveBeenCalled()
    port.reply(rendered(1))
    expect(onRendered).toHaveBeenCalledTimes(1)
    port.reply(rendered(1))
    expect(onRendered).toHaveBeenCalledTimes(1)
  })

  it('reports a failed render and moves on to the waiting request', () => {
    const { port, scheduler, onFailed } = setup()
    const first = job()
    scheduler.request(first)
    scheduler.request(job({ spec: { ...spec, id: 'next' } }))
    port.reply({ kind: 'failed', id: 1, message: 'boom' })
    expect(onFailed).toHaveBeenCalledWith('boom', first)
    expect(lastRender(port).spec.id).toBe('next')
  })

  it('moves to a new port, sending the picture again and the work it was waiting for', () => {
    const { port, scheduler, onRendered } = setup()
    scheduler.request(job())
    const replacement = fakePort()
    scheduler.usePort(replacement)
    expect(replacement.sent).toHaveLength(1)
    expect(lastRender(replacement)).toMatchObject({ source: picture })
    port.reply(rendered(1))
    expect(onRendered).not.toHaveBeenCalled()
    replacement.reply(rendered(lastRender(replacement).id))
    expect(onRendered).toHaveBeenCalledTimes(1)
  })
})
