// Inherited by build subprocesses through NODE_OPTIONS. Never contacts a service.
const { syncBuiltinESMExports } = require('node:module')
const deny = () => { throw new Error('Outbound network disabled for build regression') }
globalThis.fetch = deny
require('node:net').Socket.prototype.connect = deny
require('node:tls').connect = deny
for (const protocol of ['node:http', 'node:https']) {
  require(protocol).request = deny
  require(protocol).get = deny
}
syncBuiltinESMExports()
