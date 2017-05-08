const Jamar = require('openbci-jamar').Jamar;
var portPub = 'tcp://127.0.0.1:3004';
var zmq = require('zmq-prebuilt');
var socket = zmq.socket('pair');
var verbose = false;

let jamar = new Jamar({
  nobleAutoStart: true,
  sendCounts: true,
  verbose: true
}, (error) => {
  if (error) {
    console.log(error);
  } else {
    if (verbose) {
      console.log('Jamar initialize completed');
    }
  }
});

jamar.once('jamarFound', (peripheral) => {
  jamar.searchStop();
  jamar.on('sample', (sample) => {
    sendToPython({
      action: 'process',
      command: 'sample',
      message: sample
    });
  });
  jamar.once('ready', () => {
    jamar.streamStart();
  });
  jamar.connect(peripheral);
});

// jamar.searchStart();
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
    jamar.removeAllListeners('error');
    jamar.removeAllListeners('jamarFound');
    jamar.removeAllListeners('ready');
    jamar.destroyNoble();
  }
  if (err) console.log(err.stack);
  if (options.exit) {
    if (verbose) console.log('exit');
    if (jamar.isSearching()) {
      jamar.searchStop().catch(console.log);
    }
    jamar.manualDisconnect = true;
    jamar.disconnect(true).catch(console.log);
    process.exit(0);
  }
}

// ZMQ
socket.bind(portPub, function (err) {
  if (err) throw err;
  console.log(`bound to ${portPub}`);
});

/**
 * Used to send a message to the Python process.
 * @param  {Object} interProcessObject The standard inter-process object.
 * @return {None}
 */
var sendToPython = (interProcessObject, verbose) => {
  if (verbose) {
    console.log(`<- out ${JSON.stringify(interProcessObject)}`);
  }
  if (socket) {
    socket.send(JSON.stringify(interProcessObject));
  }
};

if (process.platform === 'win32') {
  const rl = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on('SIGINT', function () {
    process.emit('SIGINT');
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
