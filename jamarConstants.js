'use strict';
const _ = require('lodash');

/** Errors */
const errorNobleAlreadyScanning = 'Scan already under way';
const errorNobleNotAlreadyScanning = 'No scan started';
const errorNobleNotInPoweredOnState = 'Please turn blue tooth on.';
const errorInvalidByteLength = 'Invalid Packet Byte Length';
const errorInvalidByteStart = 'Invalid Start Byte';
const errorInvalidByteStop = 'Invalid Stop Byte';
const errorInvalidType = 'Invalid Type';
const errorTimeSyncIsNull = "'this.sync.curSyncObj' must not be null";
const errorTimeSyncNoComma = 'Missed the time sync sent confirmation. Try sync again';
const errorUndefinedOrNullInput = 'Undefined or Null Input';

/** Emitters */
const obciEmitterAccelerometer = 'accelerometer';
const obciEmitterBlePoweredUp = 'blePoweredOn';
const obciEmitterClose = 'close';
const obciEmitterDroppedPacket = 'droppedPacket';
const obciEmitterError = 'error';
const obciEmitterJamarFound = 'jamarFound';
const obciEmitterImpedance = 'impedance';
const obciEmitterMessage = 'message';
const obciEmitterQuery = 'query';
const obciEmitterRawDataPacket = 'rawDataPacket';
const obciEmitterReady = 'ready';
const obciEmitterSample = 'sample';
const obciEmitterSynced = 'synced';

/** Jamar */
const obciJamarPrefix = 'Jamar'
const obciJamarBleSearchTime = 20000; // ms
const jamarUuidService = '6e400001b5a3f393e0a9e50e24dcca9e'
const jamarUuidReceive = '6e400003b5a3f393e0a9e50e24dcca9e'
const jamarUuidSend = '6e400002b5a3f393e0a9e50e24dcca9e'
const jamarUuidDisconnect = '2a04'

/* OSC */
const OSClocalAddress = '127.0.0.1'
const OSClocalPort = 57121
const OSCremoteAddress = '127.0.0.1'
const OSCremotePort = 57119

/** Noble */
const obciNobleEmitterPeripheralConnect = 'connect';
const obciNobleEmitterPeripheralDisconnect = 'disconnect';
const obciNobleEmitterPeripheralDiscover = 'discover';
const obciNobleEmitterPeripheralServicesDiscover = 'servicesDiscover';
const obciNobleEmitterServiceCharacteristicsDiscover = 'characteristicsDiscover';
const obciNobleEmitterServiceRead = 'read';
const obciNobleEmitterDiscover = 'discover';
const obciNobleEmitterScanStart = 'scanStart';
const obciNobleEmitterScanStop = 'scanStop';
const obciNobleEmitterStateChange = 'stateChange';
const obciNobleStatePoweredOn = 'poweredOn';

module.exports = {
  /* OSC */
  OSCLocalAddress: OSClocalAddress,
  OSCLocalPort: OSClocalPort,
  OSCRemoteAddress: OSCremoteAddress,
  OSCRemotePort: OSCremotePort,

  /** Errors */
  OBCIEmitterAccelerometer: obciEmitterAccelerometer,
  OBCIErrorNobleAlreadyScanning: errorNobleAlreadyScanning,
  OBCIErrorNobleNotAlreadyScanning: errorNobleNotAlreadyScanning,
  OBCIErrorNobleNotInPoweredOnState: errorNobleNotInPoweredOnState,
  OBCIErrorInvalidByteLength: errorInvalidByteLength,
  OBCIErrorInvalidByteStart: errorInvalidByteStart,
  OBCIErrorInvalidByteStop: errorInvalidByteStop,
  OBCIErrorInvalidType: errorInvalidType,
  OBCIErrorTimeSyncIsNull: errorTimeSyncIsNull,
  OBCIErrorTimeSyncNoComma: errorTimeSyncNoComma,
  OBCIErrorUndefinedOrNullInput: errorUndefinedOrNullInput,

  /** Emitters */
  OBCIEmitterBlePoweredUp: obciEmitterBlePoweredUp,
  OBCIEmitterClose: obciEmitterClose,
  OBCIEmitterDroppedPacket: obciEmitterDroppedPacket,
  OBCIEmitterError: obciEmitterError,
  OBCIEmitterJamarFound: obciEmitterJamarFound,
  OBCIEmitterImpedance: obciEmitterImpedance,
  OBCIEmitterMessage: obciEmitterMessage,
  OBCIEmitterQuery: obciEmitterQuery,
  OBCIEmitterRawDataPacket: obciEmitterRawDataPacket,
  OBCIEmitterReady: obciEmitterReady,
  OBCIEmitterSample: obciEmitterSample,
  OBCIEmitterSynced: obciEmitterSynced,

  /** Jamar */
  OBCIJamarPrefix: obciJamarPrefix,
  OBCIJamarBleSearchTime: obciJamarBleSearchTime,
  jamarUuidService: jamarUuidService,
  jamarUuidReceive: jamarUuidReceive,
  jamarUuidSend: jamarUuidSend,
  jamarUuidDisconnect: jamarUuidDisconnect,

  /** Noble */
  OBCINobleEmitterPeripheralConnect: obciNobleEmitterPeripheralConnect,
  OBCINobleEmitterPeripheralDisconnect: obciNobleEmitterPeripheralDisconnect,
  OBCINobleEmitterPeripheralDiscover: obciNobleEmitterPeripheralDiscover,
  OBCINobleEmitterPeripheralServicesDiscover: obciNobleEmitterPeripheralServicesDiscover,
  OBCINobleEmitterServiceCharacteristicsDiscover: obciNobleEmitterServiceCharacteristicsDiscover,
  OBCINobleEmitterServiceRead: obciNobleEmitterServiceRead,
  OBCINobleEmitterDiscover: obciNobleEmitterDiscover,
  OBCINobleEmitterScanStart: obciNobleEmitterScanStart,
  OBCINobleEmitterScanStop: obciNobleEmitterScanStop,
  OBCINobleEmitterStateChange: obciNobleEmitterStateChange,
  OBCINobleStatePoweredOn: obciNobleStatePoweredOn,
  getPeripheralLocalNames,
  getPeripheralWithLocalName,
  getVersionNumber,
  isPeripheralJamar
};

/**
 * @description Get a list of local names from an array of peripherals
 */
function getPeripheralLocalNames (pArray) {
  return new Promise((resolve, reject) => {
    var list = [];
    _.forEach(pArray, (perif) => {
      list.push(perif.advertisement.localName);
    });
    if (list.length > 0) {
      return resolve(list);
    } else {
      return reject(`No peripherals discovered with prefix equal to ${k.OBCIJamarPrefix}`);
    }
  });
}

/**
 * @description Get a peripheral with a local name
 * @param `pArray` {Array} - Array of peripherals
 * @param `localName` {String} - The local name of the BLE device.
 */
function getPeripheralWithLocalName (pArray, localName) {
  return new Promise((resolve, reject) => {
    if (typeof (pArray) !== 'object') return reject(`pArray must be of type Object`);
    _.forEach(pArray, (perif) => {
      if (perif.advertisement.hasOwnProperty('localName')) {
        if (perif.advertisement.localName === localName) {
          return resolve(perif);
        }
      }
    });
    return reject(`No peripheral found with localName: ${localName}`);
  });
}

/**
* @description This function is used to extract the major version from a github
*  version string.
* @returns {Number} The major version number
*/
function getVersionNumber (versionStr) {
  return Number(versionStr[1]);
}

/**
 * @description Very safely checks to see if the noble peripheral is a
 *  jamar by way of checking the local name property.
 */
function isPeripheralJamar (peripheral) {
  if (peripheral) {
    if (peripheral.hasOwnProperty('advertisement')) {
      if (peripheral.advertisement !== null && peripheral.advertisement.hasOwnProperty('localName')) {
        if (peripheral.advertisement.localName !== undefined && peripheral.advertisement.localName !== null) {
          if (peripheral.advertisement.localName.indexOf(obciJamarPrefix) > -1) {
            return true;
          }
        }
      }
    }
  }
  return false;
}
