// Child CLI processes must never read the host home or contact pricing/FX services.
const os = require('node:os')
const { syncBuiltinESMExports } = require('node:module')
os.homedir = () => process.env.HOME
globalThis.fetch = async () => { throw new Error('test: network disabled') }
syncBuiltinESMExports()
