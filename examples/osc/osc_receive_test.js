const osc = require('osc')

let udpPort = new osc.UDPPort({
    localAddress: '127.0.0.1',
    localPort: 57119
})

udpPort.on('ready', function () {
    console.log('Listening for OSC over UDP.')
})

udpPort.on('message', function (oscMessage) {
  console.log(`received message: ${oscMessage.address}, args: ${oscMessage.args[0]}`)
})

udpPort.on('error', function (err) {
    console.log(err)
})

udpPort.open()
