// The app is typed for the browser, without Node's types; the test setup only needs this one export.
declare module 'node:crypto' {
  export const webcrypto: Crypto
}
