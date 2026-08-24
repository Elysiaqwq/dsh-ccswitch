/**
 * dsh-ccswitch — compatibility entry. The canonical host module is ./index.js
 * (see package.json "main"/"exports"); this file re-exports it for tooling
 * that imported ./main.js before the rename.
 */
export * from './index.js'
export { default } from './index.js'
