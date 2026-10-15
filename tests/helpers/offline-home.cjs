// Preload before the CLI imports providers: every default data path stays synthetic,
// and pricing uses the committed snapshot without contacting a live service.
const os = require('node:os')
const { syncBuiltinESMExports } = require('node:module')
const { resolve, sep } = require('node:path')
const root = resolve(process.env.CODEBURN_TEST_HOME)
const nativeHomedir = os.homedir
os.homedir = () => {
  const home = nativeHomedir()
  return home === root || home.startsWith(root + sep) ? home : root
}
globalThis.fetch = async () => { throw new Error('test: network disabled') }
for (const name of ['node:http', 'node:https']) {
  const mod = require(name)
  mod.request = mod.get = () => { throw new Error('test: network disabled') }
}
syncBuiltinESMExports()
