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
 * @author Aaron Arntz
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
  this._lastDroppedPacket = null
  this._lastPacket = null
  this._localName = null
  this._multiPacketBuffer = null
  this._packetCounter = k.OBCIJamarByteId18Bit.max
  this._peripheral = null
  this._jamarService = null
  this._receiveCharacteristic = null
  this._scanning = false
  this._sendCharacteristic = null
  this._streaming = false

  /** Public Properties (keep alphabetical) */
  this.peripheralArray = []
  this.jamarPeripheralArray = []
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
 * Used to enable the accelerometer. Will result in accelerometer packets arriving 10 times a second.
 *  Note that the accelerometer is enabled by default.
 * @return {Promise}
 */
Jamar.prototype.accelStart = function () {
  return this.write(k.OBCIAccelStart)
}

/**
 * Used to disable the accelerometer. Prevents accelerometer data packets from arriving.
 * @return {Promise}
 */
Jamar.prototype.accelStop = function () {
  return this.write(k.OBCIAccelStop)
}

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
 * @description Send a command to the board to turn a specified channel off
 * @param channelNumber
 * @returns {Promise.<T>}
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.channelOff = function (channelNumber) {
  return k.commandChannelOff(channelNumber).then((charCommand) => {
    // console.log('sent command to turn channel ' + channelNumber + ' by sending command ' + charCommand)
    return this.write(charCommand)
  })
}

/**
 * @description Send a command to the board to turn a specified channel on
 * @param channelNumber
 * @returns {Promise.<T>|*}
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.channelOn = function (channelNumber) {
  return k.commandChannelOn(channelNumber).then((charCommand) => {
    // console.log('sent command to turn channel ' + channelNumber + ' by sending command ' + charCommand)
    return this.write(charCommand)
  })
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
 * Destroys the multi packet buffer.
 */
Jamar.prototype.destroyMultiPacketBuffer = function () {
  this._multiPacketBuffer = null
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
 * Get's the multi packet buffer.
 * @return {null|Buffer} - Can be null if no multi packets received.
 */
Jamar.prototype.getMutliPacketBuffer = function () {
  return this._multiPacketBuffer
}

/**
 * Call to start testing impedance.
 * @return {global.Promise|Promise}
 */
Jamar.prototype.impedanceStart = function () {
  return this.write(k.OBCIJamarImpedanceStart)
}

/**
 * Call to stop testing impedance.
 * @return {global.Promise|Promise}
 */
Jamar.prototype.impedanceStop = function () {
  return this.write(k.OBCIJamarImpedanceStop)
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
 * @description This function is used as a convenience method to determine how many
 *              channels the current board is using.
 * @returns {Number} A number
 * Note: This is dependent on if you configured the board correctly on setup options
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.numberOfChannels = function () {
  return k.OBCINumberOfChannelsJamar
}

/**
 * @description To print out the register settings to the console
 * @returns {Promise.<T>|*}
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.printRegisterSettings = function () {
  return this.write(k.OBCIMiscQueryRegisterSettings)
}

/**
 * @description Get the the current sample rate is.
 * @returns {Number} The sample rate
 * Note: This is dependent on if you configured the board correctly on setup options
 */
Jamar.prototype.sampleRate = function () {
  if (this.options.simulate) {
    return this.options.simulatorSampleRate
  } else {
    return k.OBCISampleRate200
  }
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
    this._searchTimeout = setTimeout(() => {
      this._nobleScanStop().catch(reject)
      reject('Timeout: Unable to find Jamar')
    }, searchTime)

    this._nobleScanStart()
      .then(() => {
        resolve()
      })
      .catch((err) => {
        if (err !== k.OBCIErrorNobleAlreadyScanning) { // If it's already scanning
          clearTimeout(this._searchTimeout)
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
 * @description Sends a soft reset command to the board
 * @returns {Promise} - Fulfilled if the command was sent to board.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.softReset = function () {
  return this.write(k.OBCIMiscSoftReset)
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
 * @description Puts the board in synthetic data generation mode. Must call streamStart still.
 * @returns {Promise} indicating if the signal was able to be sent.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.syntheticEnable = function () {
  return new Promise((resolve, reject) => {
    this.write(k.OBCIJamarSyntheticDataEnable)
      .then(() => {
        if (this.options.verbose) console.log('Enabled synthetic data mode.')
        resolve()
      })
      .catch(reject)
  })
}

/**
 * @description Takes the board out of synthetic data generation mode. Must call streamStart still.
 * @returns {Promise} - fulfilled if the command was sent.
 * @author AJ Keller (@pushtheworldllc)
 */
Jamar.prototype.syntheticDisable = function () {
  return new Promise((resolve, reject) => {
    this.write(k.OBCIJamarSyntheticDataDisable)
      .then(() => {
        if (this.options.verbose) console.log('Disabled synthetic data mode.')
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
 * Builds a sample object from an array and sample number.
 * @param sampleNumber
 * @param rawData
 * @return {{sampleNumber: *}}
 * @private
 */
Jamar.prototype._buildSample = function (sampleNumber, rawData) {
  let sample = {
    sampleNumber: sampleNumber,
    timeStamp: Date.now()
  }
  if (this.options.sendCounts) {
    sample['channelDataCounts'] = rawData
  } else {
    sample['channelData'] = []
    for (let j = 0; j < k.OBCINumberOfChannelsJamar; j++) {
      sample.channelData.push(rawData[j] * k.OBCIJamarScaleFactorPerCountVolts)
    }
  }
  return sample
}

/**
 * Utilize `receivedDeltas` to get actual count values.
 * @param receivedDeltas {Array} - An array of deltas
 *  of shape 2x4 (2 samples per packet and 4 channels per sample.)
 * @private
 */
Jamar.prototype._decompressSamples = function (receivedDeltas) {
  // add the delta to the previous value
  for (let i = 1; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      this._decompressedSamples[i][j] = this._decompressedSamples[i - 1][j] - receivedDeltas[i - 1][j]
    }
  }
}

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

/**
 * Route incoming data to proper functions
 * @param data {Buffer} - Data buffer from noble Jamar.
 * @private
 */
Jamar.prototype._processBytes = function (data) {
  // if (this.options.debug) openBCIUtils.debugBytes('<<', data)
  this.lastPacket = data
  let byteId = parseInt(data[0])
  if (byteId <= k.OBCIJamarByteId19Bit.max) {
    this._processProcessSampleData(data)
  } else {
    switch (byteId) {
      case k.OBCIJamarByteIdMultiPacket:
        this._processMultiBytePacket(data)
        break
      case k.OBCIJamarByteIdMultiPacketStop:
        this._processMultiBytePacketStop(data)
        break
      case k.OBCIJamarByteIdImpedanceChannel1:
      case k.OBCIJamarByteIdImpedanceChannel2:
      case k.OBCIJamarByteIdImpedanceChannel3:
      case k.OBCIJamarByteIdImpedanceChannel4:
      case k.OBCIJamarByteIdImpedanceChannelReference:
        this._processImpedanceData(data)
        break
      default:
        this._processOtherData(data)
    }
  }
}

/**
 * Process an compressed packet of data.
 * @param data {Buffer}
 *  Data packet buffer from noble.
 * @private
 */
Jamar.prototype._processCompressedData = function (data) {
  // Save the packet counter
  this._packetCounter = parseInt(data[0])

  // Decompress the buffer into array
  if (this._packetCounter <= k.OBCIJamarByteId18Bit.max) {
    this._decompressSamples(jamarSample.decompressDeltas18Bit(data.slice(k.OBCIJamarPacket18Bit.dataStart, k.OBCIJamarPacket18Bit.dataStop)))
    switch (this._packetCounter % 10) {
      case k.OBCIJamarAccelAxisX:
        this._accelArray[0] = this.options.sendCounts ? data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) : data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) * k.OBCIJamarAccelScaleFactor
        break
      case k.OBCIJamarAccelAxisY:
        this._accelArray[1] = this.options.sendCounts ? data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) : data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) * k.OBCIJamarAccelScaleFactor
        break
      case k.OBCIJamarAccelAxisZ:
        this._accelArray[2] = this.options.sendCounts ? data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) : data.readInt8(k.OBCIJamarPacket18Bit.auxByte - 1) * k.OBCIJamarAccelScaleFactor
        this.emit(k.OBCIEmitterAccelerometer, this._accelArray)
        break
      default:
        break
    }
    const sample1 = this._buildSample(this._packetCounter * 2 - 1, this._decompressedSamples[1])
    this.emit(k.OBCIEmitterSample, sample1)

    const sample2 = this._buildSample(this._packetCounter * 2, this._decompressedSamples[2])
    this.emit(k.OBCIEmitterSample, sample2)

  } else {
    this._decompressSamples(jamarSample.decompressDeltas19Bit(data.slice(k.OBCIJamarPacket19Bit.dataStart, k.OBCIJamarPacket19Bit.dataStop)))

    const sample1 = this._buildSample((this._packetCounter - 100) * 2 - 1, this._decompressedSamples[1])
    this.emit(k.OBCIEmitterSample, sample1)

    const sample2 = this._buildSample((this._packetCounter - 100) * 2, this._decompressedSamples[2])
    this.emit(k.OBCIEmitterSample, sample2)
  }

  // Rotate the 0 position for next time
  for (let i = 0; i < k.OBCINumberOfChannelsJamar; i++) {
    this._decompressedSamples[0][i] = this._decompressedSamples[2][i]
  }
}

/**
 * Process and emit an impedance value
 * @param data {Buffer}
 * @private
 */
Jamar.prototype._processImpedanceData = function (data) {
  // if (this.options.debug) openBCIUtils.debugBytes('Impedance <<< ', data)
  const byteId = parseInt(data[0])
  let channelNumber
  switch (byteId) {
    case k.OBCIJamarByteIdImpedanceChannel1:
      channelNumber = 1
      break
    case k.OBCIJamarByteIdImpedanceChannel2:
      channelNumber = 2
      break
    case k.OBCIJamarByteIdImpedanceChannel3:
      channelNumber = 3
      break
    case k.OBCIJamarByteIdImpedanceChannel4:
      channelNumber = 4
      break
    case k.OBCIJamarByteIdImpedanceChannelReference:
      channelNumber = 0
      break
  }

  let output = {
    channelNumber: channelNumber,
    impedanceValue: 0
  }

  let end = data.length

  while (_.isNaN(Number(data.slice(1, end))) && end !== 0) {
    end--
  }

  if (end !== 0) {
    output.impedanceValue = Number(data.slice(1, end))
  }

  this.emit('impedance', output)
}

/**
 * Used to stack multi packet buffers into the multi packet buffer. This is finally emitted when a stop packet byte id
 *  is received.
 * @param data {Buffer}
 *  The multi packet buffer.
 * @private
 */
Jamar.prototype._processMultiBytePacket = function (data) {
  if (this._multiPacketBuffer) {
    this._multiPacketBuffer = Buffer.concat([this._multiPacketBuffer, data.slice(k.OBCIJamarPacket19Bit.dataStart, k.OBCIJamarPacket19Bit.dataStop)])
  } else {
    this._multiPacketBuffer = data.slice(k.OBCIJamarPacket19Bit.dataStart, k.OBCIJamarPacket19Bit.dataStop)
  }
}

/**
 * Adds the `data` buffer to the multi packet buffer and emits the buffer as 'message'
 * @param data {Buffer}
 *  The multi packet stop buffer.
 * @private
 */
Jamar.prototype._processMultiBytePacketStop = function (data) {
  this._processMultiBytePacket(data)
  this.emit(k.OBCIEmitterMessage, this._multiPacketBuffer)
  this.destroyMultiPacketBuffer()
}

Jamar.prototype._resetDroppedPacketSystem = function () {
  this._packetCounter = -1
  this._firstPacket = true
  this._droppedPacketCounter = 0
}

Jamar.prototype._droppedPacket = function (droppedPacketNumber) {
  this.emit(k.OBCIEmitterDroppedPacket, [droppedPacketNumber])
  this._droppedPacketCounter++
}

/**
 * Checks for dropped packets
 * @param data {Buffer}
 * @private
 */
Jamar.prototype._processProcessSampleData = function(data) {
  const curByteId = parseInt(data[0])
  const difByteId = curByteId - this._packetCounter

  if (this._firstPacket) {
    this._firstPacket = false
    this._processRouteSampleData(data)
    return
  }

  // Wrap around situation
  if (difByteId < 0) {
    if (this._packetCounter <= k.OBCIJamarByteId18Bit.max) {
      if (this._packetCounter === k.OBCIJamarByteId18Bit.max) {
        if (curByteId !== k.OBCIJamarByteIdUncompressed) {
          this._droppedPacket(curByteId - 1)
        }
      } else {
        let tempCounter = this._packetCounter + 1
        while (tempCounter <= k.OBCIJamarByteId18Bit.max) {
          this._droppedPacket(tempCounter)
          tempCounter++
        }
      }
    } else if (this._packetCounter === k.OBCIJamarByteId19Bit.max) {
      if (curByteId !== k.OBCIJamarByteIdUncompressed) {
        this._droppedPacket(curByteId - 1)
      }
    } else {
      let tempCounter = this._packetCounter + 1
      while (tempCounter <= k.OBCIJamarByteId19Bit.max) {
        this._droppedPacket(tempCounter)
        tempCounter++
      }
    }
  } else if (difByteId > 1) {
    if (this._packetCounter === k.OBCIJamarByteIdUncompressed && curByteId === k.OBCIJamarByteId19Bit.min) {
      this._processRouteSampleData(data)
      return
    } else {
      let tempCounter = this._packetCounter + 1
      while (tempCounter < curByteId) {
        this._droppedPacket(tempCounter)
        tempCounter++
      }
    }
  }
  this._processRouteSampleData(data)
}

Jamar.prototype._processRouteSampleData = function(data) {
  if (parseInt(data[0]) === k.OBCIJamarByteIdUncompressed) {
    this._processUncompressedData(data)
  } else {
    this._processCompressedData(data)
  }
}

/**
 * The default route when a ByteId is not recognized.
 * @param data {Buffer}
 * @private
 */
Jamar.prototype._processOtherData = function (data) {
  // openBCIUtils.debugBytes('OtherData <<< ', data)
}

/**
 * Process an uncompressed packet of data.
 * @param data {Buffer}
 *  Data packet buffer from noble.
 * @private
 */
Jamar.prototype._processUncompressedData = function (data) {
  let start = 1

  // Resets the packet counter back to zero
  this._packetCounter = k.OBCIJamarByteIdUncompressed  // used to find dropped packets
  for (let i = 0; i < 4; i++) {
    this._decompressedSamples[0][i] = interpret24bitAsInt32(data, start)  // seed the decompressor
    start += 3
  }

  const newSample = this._buildSample(0, this._decompressedSamples[0])
  this.emit(k.OBCIEmitterSample, newSample)
}

module.exports = Jamar

function interpret24bitAsInt32 (byteArray, index) {
  // little endian
  var newInt = (
    ((0xFF & byteArray[index]) << 16) |
    ((0xFF & byteArray[index + 1]) << 8) |
    (0xFF & byteArray[index + 2])
  )
  if ((newInt & 0x00800000) > 0) {
    newInt |= 0xFF000000
  } else {
    newInt &= 0x00FFFFFF
  }
  return newInt
}
