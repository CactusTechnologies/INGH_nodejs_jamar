const Jamar = require('../../index').Jamar;
const k = require('../../jamarConstants');
const verbose = true;
let jamar = new Jamar({
  debug: true,
  sendCounts: true,
  verbose: verbose
}, (error) => {
  if (error) {
    console.log(error);
  } else {
    if (verbose) {
      console.log('Jamar initialize completed');
    }
  }
});

function errorFunc (err) {
  throw err;
}

const impedance = false;
const accel = false;

jamar.once(k.OBCIEmitterJamarFound, (peripheral) => {
  jamar.searchStop().catch(errorFunc);

  let droppedPacketCounter = 0;
  let secondCounter = 0;
  let buf = [];
  let sizeOfBuf = 0;
  jamar.on('sample', (sample) => {
    /** Work with sample */
    console.log(sample.sampleNumber);

    // UNCOMMENT BELOW FOR DROPPED PACKET CALCULATIONS...
    // if (sample.sampleNumber === 0) {
    //   buf.push(droppedPacketCounter);
    //   sizeOfBuf++;
    //   droppedPacketCounter = 0;
    //   if (sizeOfBuf >= 60) {
    //     var sum = 0;
    //     for (let i = 0; i < buf.length; i++) {
    //       sum += parseInt(buf[i], 10);
    //     }
    //     const percentDropped = sum / 6000 * 100;
    //     console.log(`dropped packet rate: ${sum} - percent dropped: %${percentDropped.toFixed(2)}`);
    //     buf.shift();
    //   } else {
    //     console.log(`time till average rate starts ${60 - sizeOfBuf}`);
    //   }
    // }
  });

  jamar.on('close', () => {
    console.log('close event');
  });

  jamar.on('droppedPacket', (data) => {
    console.log('droppedPacket:', data);
    droppedPacketCounter++;
  });

  jamar.on('message', (message) => {
    console.log('message: ', message.toString());
  });

  let lastVal = 0;
  jamar.on('accelerometer', (accelData) => {
    // Use accel array [0, 0, 0]
    if (accelData[2] - lastVal > 1) {
      console.log(`Diff: ${accelData[2] - lastVal}`);
    }
    lastVal = accelData[2];
    // console.log(`counter: ${accelData[2]}`);
  });

  jamar.on('impedance', (impedanceObj) => {
    console.log(`channel ${impedanceObj.channelNumber} has impedance ${impedanceObj.impedanceValue}`);
  });

  jamar.once('ready', () => {
      // if (accel) {
      //     jamar.accelStart()
      //         .then(() => {
      //             return jamar.streamStart();
      //         })
      //         .catch(errorFunc);
      // } else if (impedance) {
      //     jamar.impedanceStart().catch(errorFunc);
      // } else {
      //
      // }
      jamar.streamStart().catch(errorFunc);
      console.log('ready');

  });

  jamar.connect("Jamar-58f3").catch(errorFunc);
});

function exitHandler (options, err) {
  if (options.cleanup) {
    if (verbose) console.log('clean');
    // console.log(connectedPeripheral)
    jamar.manualDisconnect = true;
    jamar.disconnect();
    jamar.removeAllListeners('droppedPacket');
    jamar.removeAllListeners('accelerometer');
    jamar.removeAllListeners('sample');
    jamar.removeAllListeners('message');
    jamar.removeAllListeners('impedance');
    jamar.removeAllListeners('close');
    jamar.removeAllListeners('error');
    jamar.removeAllListeners('jamarFound');
    jamar.removeAllListeners('ready');
    jamar.destroyNoble();

  }
  if (err) console.log(err.stack);
  if (options.exit) {
    if (verbose) console.log('exit');
    if (impedance) {
      jamar.impedanceStop().catch(console.log);
    }
    if (jamar.isSearching()) {
      jamar.searchStop().catch(console.log);
    }
    if (accel) {
      jamar.accelStop().catch(console.log);
    }
    jamar.manualDisconnect = true;
    jamar.disconnect(true).catch(console.log);
    process.exit(0);
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
