const NobleDevice = require('noble-device')

const JAMAR_SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e'
// const JAMAR_NOTIFY_CHAR  = '6e400003b5a3f393e0a9e50e24dcca9e'
const JAMAR_READ_CHAR    = '6e400002b5a3f393e0a9e50e24dcca9e'
// const JAMAR_WRITE_CHAR   = '6e400002b5a3f393e0a9e50e24dcca9e'

// then create your thing with the object pattern
let Jamar = function(peripheral) {
  // call nobles super constructor
  NobleDevice.call(this, peripheral)
  // setup or do anything else your module needs here
}

// tell Noble about the service uuid(s) your peripheral advertises (optional)
Jamar.SCAN_UUIDS = [JAMAR_SERVICE_UUID]

// and/or specify method to check peripheral (optional)
Jamar.is = function(peripheral) {
  return (peripheral.advertisement.localName === 'undefined')
}

// inherit noble device
NobleDevice.Util.inherits(Jamar, NobleDevice)

// you can mixin other existing service classes here too,
// noble device provides battery and device information,
// add the ones your device provides
NobleDevice.Util.mixin(Jamar, NobleDevice.BatteryService)
NobleDevice.Util.mixin(Jamar, NobleDevice.DeviceInformationService)

// read some data
Jamar.prototype.receive = function(callback) {
  this.readDataCharacteristic(JAMAR_SERVICE_UUID, JAMAR_READ_CHAR, callback);
}

// export your device
module.exports = Jamar
