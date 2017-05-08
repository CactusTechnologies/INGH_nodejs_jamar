const Jamar = require('../../index').Jamar;
const k = require('../../jamarConstants');
const verbose = true;
var jamar = new Jamar({
  debug: true,
  verbose: verbose,
  nobleScanOnPowerOn: false,
  nobleAutoStart: true
});

function errorFunc (err) {
  console.log(err);
}

const impedance = false;
const accel = false;

const fullGangFunc = () => {
  console.log(`fullGangFunc`);


  jamar.once(k.OBCIEmitterJamarFound, (peripheral) => {
    console.log('woo');
    let droppedPacketCounter = 0;
    let secondCounter = 0;
    let buf = [];
    let sizeOfBuf = 0;

    // jamar.on('sample', (sample) => {
    //   /** Work with sample */
    //   console.log(sample.sampleNumber);
    // });
    //
    // jamar.on('droppedPacket', (data) => {
    //   console.log('droppedPacket:', data);
    //   droppedPacketCounter++;
    // });
    //
    // jamar.on('message', (message) => {
    //   // console.log('message: ', message.toString());
    // });
    //
    // let lastVal = 0;
    // jamar.on('accelerometer', (accelData) => {
    //   // Use accel array [0, 0, 0]
    //   // console.log(`counter: ${accelData[2]}`);
    // });
    //
    // jamar.on('impedance', (impedanceObj) => {
    //   console.log(`channel ${impedanceObj.channelNumber} has impedance ${impedanceObj.impedanceValue}`);
    // });
    //
    // jamar.once('ready', () => {
    //   if (accel) {
    //     jamar.accelStart()
    //       .then(() => {
    //         return jamar.streamStart();
    //       })
    //       .catch(errorFunc);
    //   } else if (impedance) {
    //     jamar.impedanceStart().catch(errorFunc);
    //   } else {
    //     jamar.streamStart().catch(errorFunc);
    //   }
    // });

    jamar.searchStop()
      .then(() => {
        console.log(`search stopped`)
        jamar.connect(peripheral).catch(errorFunc)
      })
      .catch(errorFunc)

  });

    /* Start searching */
    var startSearchFunc = () => {
      jamar.searchStart().catch(errorFunc)
  }

  jamar.once(k.OBCIEmitterBlePoweredUp, startSearchFunc);
  if (jamar.isNobleReady()) {
    console.log(`noble is ready so starting scan...`);
    jamar.removeListener(k.OBCIEmitterBlePoweredUp, startSearchFunc);
    startSearchFunc()
  } else {
    console.log(`noble is NOT ready so waiting starting scan`);
  }
}


var stopTimeout;
var index = 0;

var startFunc = () => {
  console.log(`starting ${index}`);
  fullGangFunc();
  stopTimeout = setTimeout(stopFunc, 10000);
}

var stopFunc = () => {
  console.log(`disconnecting ${index}`);
  jamar.removeAllListeners('sample');
  jamar.removeAllListeners('droppedPacket');
  jamar.removeAllListeners('message');
  jamar.removeAllListeners('accelerometer');
  jamar.removeAllListeners('impedance');
  jamar.removeAllListeners(k.OBCIEmitterJamarFound);
  jamar.removeAllListeners('ready');
  if (jamar.isConnected()) {
    jamar.manualDisconnect = true;
    jamar.disconnect(true)
      .then(() => {
        if (index === 1) {
          killFunc('finished clean');
        } else {
          index++;
          startFunc();
        }
      })
      .catch(killFunc);

  } else {
    console.log(`you were never connected on index ${index}`);
    if (index === 1) {
      killFunc('failed to connect');
    } else {
      index++;
      startFunc();
    }
  }
}

var killFunc = (msg) => {
  console.log(`killFunc msg: ${msg}`);
  process.exit(0);
}

startFunc();

function exitHandler (options, err) {
  if (options.cleanup) {
    if (verbose) console.log('clean');
    jamar.manualDisconnect = true;
    jamar.disconnect();
    jamar.removeAllListeners('droppedPacket');
    jamar.removeAllListeners('accelerometer');
    jamar.removeAllListeners('sample');
    jamar.removeAllListeners('message');
    jamar.removeAllListeners('impedance');
    jamar.removeAllListeners('close');
    jamar.removeAllListeners('jamarFound');
    jamar.removeAllListeners('ready');
    jamar.destroyNoble();
  }
  if (err) console.log(err.stack);
  if (options.exit) {
    if (verbose) console.log('exit');
    clearTimeout(stopTimeout);
    if (impedance) {
      jamar.impedanceStop().catch(console.log);
    }
    if (jamar.isSearching()) {
      jamar.searchStop().catch(console.log);
    }
    if (accel) {
      jamar.accelStop().catch(console.log);
    }
    // jamar.manualDisconnect = true;
    // jamar.disconnect(true).catch(console.log);
  }
}

if (process.platform === "win32") {
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on("SIGINT", function () {
    process.emit("SIGINT");
  });
}

// do something when app is closing
process.on('exit', exitHandler.bind(null, {
  cleanup: true
}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {
  exit: true
}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {
  exit: true
}));
