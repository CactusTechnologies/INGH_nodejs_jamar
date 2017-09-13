'use strict'
const EventEmitter = require('events').EventEmitter
const _ = require('lodash')
let noble
const util = require('util')
// Local imports
const k = require('./jamarConstants')
const clone = require('clone')

const _options = {
  debug: false,
  nobleAutoStart: true,
  nobleScanOnPowerOn: true,
  verbose: true
}

/**
 * @description The initialization method to call first, before any other method.
 * @param options {object} (optional) - Board optional configurations.
 *     - `debug` {Boolean} - Print out a raw dump of bytes sent and received. (Default `false`)
 *
 *     - `nobleAutoStart` {Boolean} - Automatically initialize `noble`. Subscribes to blue tooth state changes and such.
 *           (Default `true`)
 *
 *     - `nobleScanOnPowerOn` {Boolean} - Start scanning for Jamar BLE devices as soon as power turns on.
 *           (Default `true`)
 *
 *     - `sendCounts` {Boolean} - Send integer raw counts instead of scaled floats.
 *           (Default `false`)
 *
 *     - `simulate` {Boolean} - (IN-OP) Full functionality, just mock data. Must attach Daisy module by setting
 *                  `simulatorDaisyModuleAttached` to `true` in order to get 16 channels. (Default `false`)
 *
 *     - `simulatorBoardFailure` {Boolean} - (IN-OP)  Simulates board communications failure. This occurs when the RFduino on
 *                  the board is not polling the RFduino on the dongle. (Default `false`)
 *
 *     - `simulatorHasAccelerometer` - {Boolean} - Sets simulator to send packets with accelerometer data. (Default `true`)
 *
 *     - `simulatorInjectAlpha` - {Boolean} - Inject a 10Hz alpha wave in Channels 1 and 2 (Default `true`)
 *
 *     - `simulatorInjectLineNoise` {String} - Injects line noise on channels.
 *          3 Possible Options:
 *              `60Hz` - 60Hz line noise (Default) [America]
 *              `50Hz` - 50Hz line noise [Europe]
 *              `none` - Do not inject line noise.
 *
 *     - `simulatorSampleRate` {Number} - The sample rate to use for the simulator. Simulator will set to 125 if
 *                  `simulatorDaisyModuleAttached` is set `true`. However, setting this option overrides that
 *                  setting and this sample rate will be used. (Default is `250`)
 *
 *     - `verbose` {Boolean} - Print out useful debugging events. (Default `false`)
 * @param callback {function} (optional) - A callback function used to determine if the noble module was able to be started.
 *    This can be very useful on Windows when there is no compatible BLE device found.
 * @constructor
 * @author AJ Keller, modifed for the Jamar by Aaron Arntz
 */
function Jamar (options, callback) {
  if (!(this instanceof Jamar)) {
    return new Jamar(options, callback)
  }

  if (options instanceof Function) {
    callback = options
    options = {}
  }

  options = (typeof options !== 'function') && options || {}
  let opts = {}

  /** Configuring Options */
  let o
  for (o in _options) {
    var userOption = (o in options) ? o : o.toLowerCase()
    var userValue = options[userOption]
    delete options[userOption]

    if (typeof _options[o] === 'object') {
      // an array specifying a list of choices
      // if the choice is not in the list, the first one is defaulted to

      if (_options[o].indexOf(userValue) !== -1) {
        opts[o] = userValue
      } else {
        opts[o] = _options[o][0]
      }
    } else {
      // anything else takes the user value if provided, otherwise is a default

      if (userValue !== undefined) {
        opts[o] = userValue
      } else {
        opts[o] = _options[o]
      }
    }
  }

  for (o in options) throw new Error('"' + o + '" is not a valid option')

  // Set to global options object
  this.options = clone(opts)

  /** Private Properties (keep alphabetical) */
  this._accelArray = [0, 0, 0]
  this._connected = false
  this._decompressedSamples = new Array(3)
  this._droppedPacketCounter = 0
  this._firstPacket = true
  this._jamarService = null
  this._lastDroppedPacket = null
  this._lastPacket = null
  this._localName = null
  this._multiPacketBuffer = null
  this._peripheral = null
  this._receiveCharacteristic = null
  this._scanning = false
  this._sendCharacteristic = null
  this._streaming = false

  /** Public Properties (keep alphabetical) */
  this.jamarPeripheralArray = []
  this.peripheralArray = []
  this.previousPeripheralArray = []
  this.manualDisconnect = false

  /** Initializations */
  for (var i = 0; i < 3; i++) {
    this._decompressedSamples[i] = [0, 0, 0, 0]
  }

  try {
    noble = require('noble')
    if (this.options.nobleAutoStart) this._nobleInit() // It get's the noble going
    if (callback) callback()
  } catch (e) {
    if (callback) callback(e)
  }
}

// This allows us to use the emitter class freely outside of the module
util.inherits(Jamar, EventEmitter)

/**
 * Used to start a scan if power is on. Useful if a connection is dropped.
 */
Jamar.prototype.autoReconnect = function () {
  // TODO: send back reconnect status, or reconnect fail
  if (noble.state === k.OBCINobleStatePoweredOn) {
    this._nobleScanStart()
  } else {
    console.warn('BLE not AVAILABLE')
  }
}

/**
 * @description The essential precursor method to be called initially to establish a
 *              ble connection to the jamar.
 * @param id {String | Object} - a string local name or peripheral object
 * @returns {Promise} If the board was able to connect.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.connect = function (id) {
  return new Promise((resolve, reject) => {
    if (_.isString(id)) {
      k.getPeripheralWithLocalName(this.jamarPeripheralArray, id)
        .then((p) => {
          return this._nobleConnect(p)
        })
        .then(resolve)
        .catch(reject)
    } else if (_.isObject(id)) {
      this._nobleConnect(id)
        .then(resolve)
        .catch(reject)
    } else {
      reject(k.OBCIErrorInvalidByteLength)
    }
  })
}

/**
 * Destroys the noble!
 */
Jamar.prototype.destroyNoble = function () {
  this._nobleDestroy()
}

/**
 * @description Closes the connection to the board. Waits for stop streaming command to
 *  be sent if currently streaming.
 * @param stopStreaming {Boolean} (optional) - True if you want to stop streaming before disconnecting.
 * @returns {Promise} - fulfilled by a successful close, rejected otherwise.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.disconnect = function (stopStreaming) {
  // no need for timeout here streamStop already performs a delay
  return Promise.resolve()
    .then(() => {
      if (stopStreaming) {
        if (this.isStreaming()) {
          if (this.options.verbose) console.log('stop streaming')
          return this.streamStop()
        }
      }
      return Promise.resolve()
    })
    .then(() => {
      return new Promise((resolve, reject) => {
        // serial emitting 'close' will call _disconnected
        if (this._peripheral) {
          this._peripheral.disconnect((err) => {
            if (err) {
              this._disconnected()
              reject(err)
            } else {
              this._disconnected()
              resolve()
            }
          })
        } else {
          reject('no peripheral to disconnect')
        }
      })
    })
}

/**
 * Return the local name of the attached Jamar device.
 * @return {null|String}
 */
Jamar.prototype.getLocalName = function () {
  return this._localName
}

/**
 * @description Checks if the driver is connected to a board.
 * @returns {boolean} - True if connected.
 */
Jamar.prototype.isConnected = function () {
  return this._connected
}

/**
 * @description Checks if bluetooth is powered on.
 * @returns {boolean} - True if bluetooth is powered on.
 */
Jamar.prototype.isNobleReady = function () {
  return this._nobleReady()
}

/**
 * @description Checks if noble is currently scanning.
 * @returns {boolean} - True if streaming.
 */
Jamar.prototype.isSearching = function () {
  return this._scanning
}

/**
 * @description Checks if the board is currently sending samples.
 * @returns {boolean} - True if streaming.
 */
Jamar.prototype.isStreaming = function () {
  return this._streaming
}

/**
 * @description List available peripherals so the user can choose a device when not
 *              automatically found.
 * @param `maxSearchTime` {Number} - The amount of time to spend searching. (Default is 20 seconds)
 * @returns {Promise} - If scan was started
 */
Jamar.prototype.searchStart = function (maxSearchTime) {
  const searchTime = maxSearchTime || k.OBCIJamarBleSearchTime

  return new Promise((resolve, reject) => {
    // this._searchTimeout = setTimeout(() => {
      // this._nobleScanStop().catch(reject)
      // reject('Timeout: Unable to find Jamar')
    // }, searchTime)

    this._nobleScanStart()
      .then(() => {
        resolve()
      })
      .catch((err) => {
        if (err !== k.OBCIErrorNobleAlreadyScanning) { // If it's already scanning
          // clearTimeout(this._searchTimeout)
          reject(err)
        }
      })
  })
}

/**
 * Called to end a search.
 * @return {global.Promise|Promise}
 */
Jamar.prototype.searchStop = function () {
  return this._nobleScanStop()
}

/**
 * @description Sends a start streaming command to the board.
 * @returns {Promise} indicating if the signal was able to be sent.
 * Note: You must have successfully connected to an OpenBCI board using the connect
 *           method. Just because the signal was able to be sent to the board, does not
 *           mean the board will start streaming.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.streamStart = function () {
  return new Promise((resolve, reject) => {
    if (this.isStreaming()) return reject('Error [.streamStart()]: Already streaming')
    this._streaming = true
    this.write(k.OBCIStreamStart)
      .then(() => {
        if (this.options.verbose) console.log('Sent stream start to board.')
        resolve()
      })
      .catch(reject)
  })
}

/**
 * @description Sends a stop streaming command to the board.
 * @returns {Promise} indicating if the signal was able to be sent.
 * Note: You must have successfully connected to an OpenBCI board using the connect
 *           method. Just because the signal was able to be sent to the board, does not
 *           mean the board stopped streaming.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.streamStop = function () {
  return new Promise((resolve, reject) => {
    if (!this.isStreaming()) return reject('Error [.streamStop()]: No stream to stop')
    this._streaming = false
    this.write(k.OBCIStreamStop)
      .then(() => {
        resolve()
      })
      .catch(reject)
  })
}

/**
 * @description Used to send data to the board.
 * @param data {Array | Buffer | Number | String} - The data to write out
 * @returns {Promise} - fulfilled if command was able to be sent
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.write = function (data) {
  return new Promise((resolve, reject) => {
    if (this._sendCharacteristic) {
      if (!Buffer.isBuffer(data)) {
        data = new Buffer(data)
      }
      this._sendCharacteristic.write(data, true, (err) => {
        if (err) {
          reject(err)
        } else {
          // if (this.options.debug) openBCIUtils.debugBytes('>>>', data)
          resolve()
        }
      })
    } else {
      reject('Send characteristic not set, please call connect method')
    }
  })
}

// //////// //
// PRIVATES //
// //////// //
/**
 * @description Called once when for any reason the ble connection is no longer open.
 * @private
 */
Jamar.prototype._disconnected = function () {
  this._streaming = false
  this._connected = false

  // Clean up _noble
  // TODO: Figure out how to fire function on process ending from inside module
  // noble.removeListener('discover', this._nobleOnDeviceDiscoveredCallback)

  if (this._receiveCharacteristic) {
    this._receiveCharacteristic.removeAllListeners(k.OBCINobleEmitterServiceRead)
  }

  this._receiveCharacteristic = null

  if (this._jamarService) {
    this._jamarService.removeAllListeners(k.OBCINobleEmitterServiceCharacteristicsDiscover)
  }

  this._jamarService = null

  if (this._peripheral) {
    this._peripheral.removeAllListeners(k.OBCINobleEmitterPeripheralConnect)
    this._peripheral.removeAllListeners(k.OBCINobleEmitterPeripheralDisconnect)
    this._peripheral.removeAllListeners(k.OBCINobleEmitterPeripheralServicesDiscover)
  }

  this._peripheral = null

  if (!this.manualDisconnect) {
    // this.autoReconnect()
  }

  if (this.options.verbose) console.log(`[JAMAR] disconnect clean up`)

  this.emit('close')
}

/**
 * Call to destroy the noble event emitters.
 * @private
 */
Jamar.prototype._nobleDestroy = function () {
  if (noble)  {
    noble.removeAllListeners(k.OBCINobleEmitterStateChange)
    noble.removeAllListeners(k.OBCINobleEmitterDiscover)
  }
}

Jamar.prototype._nobleConnect = function (peripheral) {
  return new Promise((resolve, reject) => {
    if (this.isConnected()) return reject('already connected!')

    this._peripheral = peripheral
    this._localName = peripheral.advertisement.localName

    if (this.options.verbose) console.log('[JAMAR] Device is advertising \'' + this._peripheral.advertisement.localName + '\' service.')
    // if (this.options.verbose) console.log("[JAMAR] serviceUUID: " + this._peripheral.advertisement.serviceUuids)

    this._peripheral.on(k.OBCINobleEmitterPeripheralConnect, () => {
      if (this.options.verbose) console.log("[JAMAR] got connected event...")
      this._peripheral.discoverServices()
      if (this.isSearching()) this._nobleScanStop()
    })

    this._peripheral.on(k.OBCINobleEmitterPeripheralDisconnect, () => {
      if (this.options.verbose) console.log('[JAMAR] peripheral disconnected...')
      this._disconnected()
    })

    this._peripheral.on(k.OBCINobleEmitterPeripheralServicesDiscover, (services) => {

      for (var i = 0; i < services.length; i++) {
        if (this.options.verbose) console.log(services[i].uuid)
        if (services[i].uuid === k.jamarUuidService) {
          this._jamarService = services[i]
          if (this.options.verbose) console.log("[JAMAR] Found Jamar service")
          break
        }
      }

      if (!this._jamarService) {
        reject('[JAMAR] Could not find the Jamar service.')
      }

      this._jamarService.once(k.OBCINobleEmitterServiceCharacteristicsDiscover, (characteristics) => {
        if (this.options.verbose) console.log('[JAMAR] Discovered ' + characteristics.length + ' service characteristics')
        for (var i = 0; i < characteristics.length; i++) {

          if (characteristics[i].uuid === k.jamarUuidReceive) {
            if (this.options.verbose) console.log("[JAMAR] Found receiveCharacteristicUUID")
            this._receiveCharacteristic = characteristics[i]
          }
          if (characteristics[i].uuid === k.jamarUuidSend) {
            if (this.options.verbose) console.log("[JAMAR] Found sendCharacteristicUUID")
            this._sendCharacteristic = characteristics[i]
          }
        }

        if (this._receiveCharacteristic && this._sendCharacteristic) {
          this._receiveCharacteristic.on(k.OBCINobleEmitterServiceRead, (data) => {
            // TODO: handle all the data, both streaming and not
            // console.log(`received data: ${data}`)
            this._processData(data)
            // this._processBytes(data)
          })

          if (this.options.verbose) console.log('[JAMAR] subscribing for data notifications...')
            this._receiveCharacteristic.notify(true)
            this._connected = true
            this.emit(k.OBCIEmitterReady)
            resolve()
          }
          else {
            reject('[JAMAR] Unable to set both receive and send characteristics...')
          }
      })

      this._jamarService.discoverCharacteristics()
    })

    this._peripheral.connect((err) => {
      if (err) {
        if (this.options.verbose) console.log(`Unable to connect with error: ${err}`)
        this._disconnected()
        reject(err)
      }
    })
  })
}

/**
 * Call to add the noble event listeners.
 * @private
 */
Jamar.prototype._nobleInit = function () {
  noble.on(k.OBCINobleEmitterStateChange, (state) => {
    // TODO: send state change error to gui

    // If the peripheral array is empty, do a scan to fill it.
    if (state === k.OBCINobleStatePoweredOn) {
      if (this.options.verbose) console.log('Bluetooth powered on')
      this.emit(k.OBCIEmitterBlePoweredUp)
      if (this.options.nobleScanOnPowerOn) {
        this._nobleScanStart().catch((err) => {
          console.log(err)
        })
      }
      if (this.peripheralArray.length === 0) {
      }
    } else {
      if (this.isSearching()) {
        this._nobleScanStop().catch((err) => {
          console.log(err)
        })
      }
    }
  })

  noble.on(k.OBCINobleEmitterDiscover, this._nobleOnDeviceDiscoveredCallback.bind(this))
}

/**
 * Event driven function called when a new device is discovered while scanning.
 * @param peripheral {Object} Peripheral object from noble.
 * @private
 */
Jamar.prototype._nobleOnDeviceDiscoveredCallback = function (peripheral) {
  // if(this.options.verbose) console.log(peripheral.advertisement)
  this.peripheralArray.push(peripheral)
  if (k.isPeripheralJamar(peripheral)) {
    if (this.options.verbose) console.log('Found jamar!')
    if (_.isUndefined(_.find(this.jamarPeripheralArray,
        (p) => {
          return p.advertisement.localName === peripheral.advertisement.localName
        }))) {
      this.jamarPeripheralArray.push(peripheral)
    }
    this.emit(k.OBCIEmitterJamarFound, peripheral)
  }
}

Jamar.prototype._nobleReady = function () {
  return noble.state === k.OBCINobleStatePoweredOn
}

/**
 * Call to perform a scan to get a list of peripherals.
 * @returns {global.Promise|Promise}
 * @private
 */
Jamar.prototype._nobleScanStart = function () {
  return new Promise((resolve, reject) => {
    if (this.isSearching()) return reject(k.OBCIErrorNobleAlreadyScanning)
    if (!this._nobleReady()) return reject(k.OBCIErrorNobleNotInPoweredOnState)

    this.peripheralArray = []
    noble.once(k.OBCINobleEmitterScanStart, () => {
      if (this.options.verbose) console.log('Scan started')
      this._scanning = true
      this.emit(k.OBCINobleEmitterScanStart)
      resolve()
    })
    // Only look so jamar ble devices and allow duplicates (multiple jamars)
    // noble.startScanning([k.jamarUuidService], true)
    noble.startScanning([], false)
  })
}

/**
 * Stop an active scan
 * @return {global.Promise|Promise}
 * @private
 */
Jamar.prototype._nobleScanStop = function () {
  return new Promise((resolve, reject) => {
    if (!this.isSearching()) return reject(k.OBCIErrorNobleNotAlreadyScanning)
    if (this.options.verbose) console.log(`Stopping scan`)

    noble.once(k.OBCINobleEmitterScanStop, () => {
      this._scanning = false
      this.emit(k.OBCINobleEmitterScanStop)
      if (this.options.verbose) console.log('Scan stopped')
      resolve()
    })
    // Stop noble from scanning
    noble.stopScanning()
  })
}
/**
 * Route incoming data to proper functions
 * @param data {Buffer} - Data buffer from noble Jamar represented as ASCII
 * @private
 */
Jamar.prototype._processData = function (data) {
  this.emit('data', parseFloat(data.slice(8)))
}

module.exports = Jamar
