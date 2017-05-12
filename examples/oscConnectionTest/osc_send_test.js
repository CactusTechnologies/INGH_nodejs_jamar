const osc = require('osc')

let udpPort = new osc.UDPPort({
    // This is the port we're listening on.
    localAddress: "0.0.0.0",
    localPort: 57121,

    // This is where osc_receive_test.js is listening for OSC messages.
    // remoteAddress: "http://192.168.1.76",
    // remotePort: 57119,
    metadata: true
})

// Open the socket.
udpPort.open()

// Every second, send an OSC message
udpPort.on("ready", function () {
  setInterval(function() {
      let msg = {
          address: '/hello/from/oscjs',
          args: [
              {
                  type: "f",
                  value: Math.random()
              },
              {
                  type: "f",
                  value: Math.random()
              }
          ]
      }

      console.log("Sending message", msg.address, msg.args, "to", udpPort.options.remoteAddress + ":" + udpPort.options.remotePort)
      udpPort.send(msg, "192.168.1.106", 8080)
  }, 10)
})
