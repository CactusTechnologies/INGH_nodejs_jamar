const Jamar = require('../../index').Jamar
const k = require('../../jamarConstants')
const osc = require('osc')
const verbose = true
let jamar = new Jamar({
  debug: true,
  verbose: verbose,
  nobleScanOnPowerOn: false,
  nobleAutoStart: true
})

function errorFunc (err) {
  console.log(err)
}

/* OSC setup */
let udpPort = new osc.UDPPort({
    // This is the port we're listening on.
    localAddress: k.OSCLocalAddress,
    localPort: k.OSCLocalPort,

    // This is the address of the OSC receiver
    remoteAddress: k.OSCRemoteAddress,
    remotePort: k.OSCRemotePort,
    metadata: true
})
udpPort.open()

/* Start the function */
const fullGangFunc = () => {
  console.log('[JAMARCONNECT] running application')

  jamar.once(k.OBCIEmitterJamarFound, (peripheral) => {
    console.log('[JAMARCONNECT] connected to jamar...')

    /* Event Handlers */

    // Bluetooth comes in, sent out as OSC
    jamar.on('data', (data) => {
      console.log(`[JAMARCONNECT] DATA: ${data}`)
      let msg = {
        address: '/jamar/data',
        args: [
            {
                type: "f",
                value: data
            }
        ]
      }
      console.log("Sending message", msg.address, msg.args, "to", udpPort.options.remoteAddress + ":" + udpPort.options.remotePort)
      udpPort.send(msg)
    })

    jamar.once('ready', () => {
      console.log('[JAMARCONNECT] ready to receive strength data..')
    })

    jamar.searchStop()
      .then(() => {
        console.log(`[JAMARCONNECT] search stopped`)
        jamar.connect(peripheral).catch(errorFunc)
      })
      .catch(errorFunc)
  })

    /* Start searching */
    let startSearchFunc = () => {
      jamar.searchStart().catch(errorFunc)
  }

    jamar.once(k.OBCIEmitterBlePoweredUp, startSearchFunc)

    /* Entry Point */
  if (jamar.isNobleReady()) {
    console.log(`[JAMARCONNECT] noble is ready so starting scan...`)
    jamar.removeListener(k.OBCIEmitterBlePoweredUp, startSearchFunc)
    startSearchFunc()
  } else {
    console.log(`[JAMARCONNECT] noble is NOT ready, waiting to start scan...`)
  }
}

let index = 0
let startFunc = () => {
  console.log(`[JAMARCONNECT] starting ${index}`)
  fullGangFunc()
}

let stopFunc = () => {
  console.log(`[JAMARCONNECT] disconnecting ${index}`)
  jamar.removeAllListeners(k.OBCIEmitterJamarFound)
  jamar.removeAllListeners('ready')
  if (jamar.isConnected()) {
    jamar.manualDisconnect = true
    jamar.disconnect(true)
      .then(() => {
        if (index === 1) {
          killFunc('finished clean')
        } else {
          index++
          startFunc()
        }
      })
      .catch(killFunc)

  } else {
    console.log(`you were never connected on index ${index}`)
    if (index === 1) {
      killFunc('failed to connect')
    } else {
      index++
      startFunc()
    }
  }
}

let killFunc = (msg) => {
  console.log(`killFunc msg: ${msg}`)
  process.exit(0)
}

startFunc()

function exitHandler (options, err) {
  if (options.cleanup) {
    if (verbose) console.log('clean')
    jamar.manualDisconnect = true
    jamar.disconnect()
    jamar.removeAllListeners('close')
    jamar.removeAllListeners('jamarFound')
    jamar.removeAllListeners('ready')
    jamar.destroyNoble()
  }
  if (err) console.log(err.stack)
  if (options.exit) {
    if (verbose) console.log('exit')

    stopFunc()

    if (jamar.isSearching()) {
      jamar.searchStop().catch(console.log)
    }
  }
}

if (process.platform === "win32") {
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  })

  rl.on("SIGINT", function () {
    process.emit("SIGINT")
  })
}

// do something when app is closing
process.on('exit', exitHandler.bind(null, {
  cleanup: true
}))

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
  exit: true
}))

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
  exit: true
}))
