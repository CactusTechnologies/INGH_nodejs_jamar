const Jamar = require("../index").Jamar;
const k = require("../jamarConstants");
const osc = require("osc");
const verbose = true;

require("dotenv").config();
const { HOST, PORT } = process.env;

let jamar = new Jamar({
  debug: true,
  verbose: verbose,
  nobleScanOnPowerOn: false,
  nobleAutoStart: true
});

// setup an express server, mainly for status reporting
const express = require("express");
const bodyParser = require("body-parser");
const app = express();

app.set("root", __dirname);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.disable("x-powered-by");

app.use((err, req, res, next) => {
  console.log("error middleware called");
  console.error(err);
  res.status(500).json(err);
});

app.listen(PORT, function() {
  console.log(`App listening on port ${PORT}`);
});

const WebSocket = require("ws");

// create a Var for reporting the status
let deviceConnected = false;
let highScore = 0;
let currentHand = "";
let shownHighScore = false;

function errorFunc(err) {
  console.log(err);
}

/* OSC setup */
let udpPort = new osc.UDPPort({
  localAddress: k.OSCLocalAddress,
  localPort: k.OSCLocalPort,
  metadata: true
});
udpPort.open();
udpPort.on("ready", function() {
  console.log("ready udp");
});

/* Websockets setup */
const ws = new WebSocket("ws://10.0.20.10:3030/jamarPi");
ws.on("open", () => {
  ws.send("jamar pi websocket connected.");
});

/* A message received from the tablet over websockets */
ws.on("message", data => {
  console.log(data);
  let jsondata = JSON.parse(data);
  // console.log(jsondata.msg)
  switch (jsondata.msg) {
    case "strength/start":
      console.log("got start message");
      startFunc();
      break;

    case "strength/startLeft":
      console.log("starting left hand");
      currentHand = "LEFT";
      highScore = 0;
      shownHighScore = false;
      break;

    case "strength/startRight":
      console.log("starting right hand");
      currentHand = "RIGHT";
      highScore = 0;
      shownHighScore = false;
      break;

    case "strength/sleep":
      console.log("station going to sleep");
      currentHand = "none";
      highScore = 0;
      break;

    case "strength/kill":
      console.log("got kill message");
      stopFunc();
      break;
    default:
      break;
  }
});

ws.on("close", () => {
  process.exit(0);
});

/* Start the bluetooth function */
const fullGangFunc = () => {
  console.log("[JAMARCONNECT] running application");

  jamar.once(k.OBCIEmitterJamarFound, peripheral => {
    console.log("[JAMARCONNECT] connected to jamar...");

    deviceConnected = true;

    /* Event Handlers */
    // Bluetooth comes in, sent out as OSC
    jamar.on("data", data => {
      // console.log(`[JAMARCONNECT] DATA: ${data}`);
      let msg = {
        address: "/jamar/data",
        args: [
          {
            type: "f",
            value: data
          }
        ]
      };
      // console.log("value: ", data);
      if (data > highScore) highScore = data;
      if (highScore - data > 10 && !shownHighScore) {
        console.log(`high score for ${currentHand}: ${highScore}`);
        shownHighScore = true;
      }

      //console.log("Sending message", msg.address, msg.args, "to", "10.0.20.63" + ":" + '8080') //63
      udpPort.send(msg, "10.0.20.63", 8080);
    });

    jamar.once("ready", () => {
      console.log("[JAMARCONNECT] ready to receive strength data..");
    });

    jamar
      .searchStop()
      .then(() => {
        console.log(`[JAMARCONNECT] search stopped`);
        jamar.connect(peripheral).catch(errorFunc);
      })
      .catch(errorFunc);
  });

  /* Start searching */
  let startSearchFunc = () => {
    jamar.searchStart().catch(errorFunc);
  };

  jamar.once(k.OBCIEmitterBlePoweredUp, startSearchFunc);

  /* Entry Point */
  if (jamar.isNobleReady()) {
    console.log(`[JAMARCONNECT] noble is ready so starting scan...`);
    jamar.removeListener(k.OBCIEmitterBlePoweredUp, startSearchFunc);
    startSearchFunc();
  } else {
    console.log(`[JAMARCONNECT] noble is NOT ready, waiting to start scan...`);
  }

  jamar.once("close", () => {
    stopFunc();
  });
};

let index = 0;
let startFunc = () => {
  console.log(`[JAMARCONNECT] starting ${index}`);
  fullGangFunc();
};

let stopFunc = () => {
  console.log(`[JAMARCONNECT] disconnecting ${index}`);
  highScore = 0;
  jamar.removeAllListeners(k.OBCIEmitterJamarFound);
  jamar.removeAllListeners("ready");
  if (jamar.isConnected()) {
    jamar.manualDisconnect = true;
    jamar
      .disconnect(true)
      .then(() => {
        killFunc("finished clean");
      })
      .catch(killFunc);
  } else {
    console.log(`you were never connected on index ${index}`);
    killFunc("never connected");
  }
};

let killFunc = msg => {
  console.log(`killFunc msg: ${msg}`);
  process.exit(0);
};

startFunc();

// STATUS REPORTING
app.get("/status", (req, res, next) => {
  console.log("server requested status-report");
  let status = {
    jamarConnected: deviceConnected
  };

  res.send(status);
});

function exitHandler(options, err) {
  if (options.cleanup) {
    if (verbose) console.log("clean");
    jamar.manualDisconnect = true;
    jamar.disconnect();
    jamar.removeAllListeners("close");
    jamar.removeAllListeners("jamarFound");
    jamar.removeAllListeners("ready");
    jamar.destroyNoble();
  }
  if (err) console.log(err.stack);
  if (options.exit) {
    if (verbose) console.log("exit");

    stopFunc();

    if (jamar.isSearching()) {
      jamar.searchStop().catch(console.log);
    }
  }
}

if (process.platform === "win32") {
  const rl = require("readline").createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.on("SIGINT", function() {
    process.emit("SIGINT");
  });
}

// do something when app is closing
process.on(
  "exit",
  exitHandler.bind(null, {
    cleanup: true
  })
);

// catches ctrl+c event
process.on(
  "SIGINT",
  exitHandler.bind(null, {
    exit: true
  })
);

// catches uncaught exceptions
process.on(
  "uncaughtException",
  exitHandler.bind(null, {
    exit: true
  })
);
