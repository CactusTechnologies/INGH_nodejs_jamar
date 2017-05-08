'use strict';
// const bluebirdChecks = require('./bluebirdChecks');
const sinon = require('sinon');
const chai = require('chai');
const expect = chai.expect;
const should = chai.should(); // eslint-disable-line no-unused-vars
const Jamar = require('../openBCIJamar');
const k = require('../jamarConstants');
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
const bufferEqual = require('buffer-equal');
const jamarSample = require('../openBCIJamarSample');
const clone = require('clone');

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('#jamar-constructor', function () {
  it('should callback if only callback used', function (done) {
    const cb = (err) => {
      done(err);
    };
    const jamar_cb = new Jamar(cb);
  });
  it('should callback if options and callback', function (done) {
    const cb = (err) => {
      done(err);
    };
    const jamar_cb = new Jamar({}, cb);
  });
});

describe('#jamar', function () {
  const mockProperties = {
    nobleAutoStart: false,
    nobleScanOnPowerOn: false,
    simulate: false,
    simulatorBoardFailure: false,
    simulatorHasAccelerometer: true,
    simulatorInternalClockDrift: 0,
    simulatorInjectAlpha: true,
    simulatorInjectLineNoise: k.OBCISimulatorLineNoiseHz60,
    simulatorSampleRate: 200,
    verbose: false,
    debug: false,
    sendCounts: false
  };
  const expectedProperties = clone(mockProperties);
  const jamar = new Jamar(mockProperties);
  it('should have properties', function () {
    expect(jamar.options).to.deep.equal(expectedProperties);
  });
  it('should return 4 channels', function () {
    expect(jamar.numberOfChannels()).to.equal(4);
  });
  it('should destroy the multi packet buffer', function () {
    jamar.destroyMultiPacketBuffer();
    expect(jamar.getMutliPacketBuffer()).to.equal(null);
  });
  it('should stack and emit one buffer from several multi packet buffer', function () {
    const bufMultPacket = new Buffer([k.OBCIJamarByteIdMultiPacket]);
    const bufMultPacketStop = new Buffer([k.OBCIJamarByteIdMultiPacketStop]);
    const buf1 = new Buffer('taco');
    const newBuffer1 = Buffer.concat([bufMultPacket, buf1]);
    jamar._processMultiBytePacket(newBuffer1);
    expect(bufferEqual(jamar.getMutliPacketBuffer(), buf1)).to.equal(true);

    const buf2 = new Buffer('vegas');
    const newBuffer2 = Buffer.concat([bufMultPacket, buf2]);
    jamar._processMultiBytePacket(newBuffer2);
    expect(bufferEqual(jamar.getMutliPacketBuffer(), Buffer.concat([buf1, buf2])));

    const bufStop = new Buffer('hola');
    const newBufferStop = Buffer.concat([bufMultPacketStop, bufStop]);
    let messageEventCalled = false;
    jamar.once('message', (data) => {
      expect(bufferEqual(data, Buffer.concat([buf1, buf2, bufStop]))).to.equal(true);
      messageEventCalled = true;
    });
    jamar._processMultiBytePacketStop(newBufferStop);
    expect(jamar.getMutliPacketBuffer()).to.equal(null);
    expect(messageEventCalled).to.equal(true);

    jamar.once('message', (data) => {
      expect(bufferEqual(data, bufStop)).to.equal(true);
    });
    jamar._processMultiBytePacketStop(newBufferStop);
    expect(jamar.getMutliPacketBuffer()).to.equal(null);
  });
  it('should be able to just get one packet buffer message', function () {
    const bufStop = new Buffer('hola');
    const bufMultPacketStop = new Buffer([k.OBCIJamarByteIdMultiPacketStop]);
    const newBufferStop = Buffer.concat([bufMultPacketStop, bufStop]);
    let messageEventCalled = false;
    jamar.once('message', (data) => {
      expect(bufferEqual(data, bufStop)).to.equal(true);
      messageEventCalled = true;
    });
    jamar._processMultiBytePacketStop(newBufferStop);
    expect(jamar.getMutliPacketBuffer()).to.equal(null);
    expect(messageEventCalled).to.equal(true);
  });
  describe('#_processProcessSampleData', function () {
    let funcSpyCompressedData;
    let funcSpyDroppedPacket;
    let funcSpyUncompressedData;
    before(function () {
      funcSpyCompressedData = sinon.spy(jamar, '_processCompressedData');
      funcSpyDroppedPacket = sinon.spy(jamar, '_droppedPacket');
      funcSpyUncompressedData = sinon.spy(jamar, '_processUncompressedData');
    });
    beforeEach(function () {
      funcSpyCompressedData.reset();
      funcSpyDroppedPacket.reset();
      funcSpyUncompressedData.reset();
      jamar._resetDroppedPacketSystem();
    });
    describe('18bit', function () {
      it('should call proper functions if no dropped packets', function () {
        it('should work on uncompressed data', function () {
          jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
          funcSpyUncompressedData.should.have.been.called;
          funcSpyDroppedPacket.should.not.have.been.called;
        });

        it('should work on compressed data', function () {
          jamar._processProcessSampleData(jamarSample.sampleCompressedData(1));
          funcSpyCompressedData.should.have.been.called;
          funcSpyDroppedPacket.should.not.have.been.called;
        });
      });
      it('should recognize 0 packet dropped', function () {
        // Send the last buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId18Bit.max));
        funcSpyCompressedData.should.have.been.called;
        const expectedMissedSample = k.OBCIJamarByteIdUncompressed;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyCompressedData.should.have.been.calledTwice;
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should not find a dropped packet on wrap around', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId18Bit.max - 1));
        funcSpyCompressedData.should.have.been.calledOnce;
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId18Bit.max));
        funcSpyCompressedData.should.have.been.calledTwice;
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        funcSpyCompressedData.should.have.been.calledTwice;
        funcSpyUncompressedData.should.have.been.calledOnce;
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteIdUncompressed + 1));
        funcSpyCompressedData.should.have.been.calledThrice;
        funcSpyDroppedPacket.should.not.have.been.called;
      });
      it('should recognize dropped packet 99', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId18Bit.max - 1));
        const expectedMissedSample = k.OBCIJamarByteId18Bit.max;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleUncompressedData();
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should recognize dropped packet 98 and 99', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId18Bit.max - 2));
        const expectedMissedSample1 = k.OBCIJamarByteId18Bit.max - 1;
        const expectedMissedSample2 = k.OBCIJamarByteId18Bit.max;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleUncompressedData();
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample1);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample2);
      });
      it('should detect dropped packet 1 and process packet 2', function () {
        // Send the raw buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        const expectedMissedSample = k.OBCIJamarByteIdUncompressed + 1;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should detect dropped packet 1 & 2 and add process packet 3', function () {
        // Send the last buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        const expectedMissedSample1 = k.OBCIJamarByteIdUncompressed + 1;
        const expectedMissedSample2 = k.OBCIJamarByteIdUncompressed + 2;
        // Call the function under test with two more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample2 + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample1);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample2);
      });
      it('should emit a accel data array with counts', function () {
        const bufAccelX = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisX);
        const bufAccelY = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisY);
        const bufAccelZ = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisZ);
        const expectedXCount = 0;
        const expectedYCount = 1;
        const expectedZCount = 2;
        bufAccelX[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedXCount;
        bufAccelY[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedYCount;
        bufAccelZ[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedZCount;
        const dimensions = 3;
        let accelDataFuncCalled = false;
        const accelDataFunc = (accelData) => {
          accelDataFuncCalled = true;
          expect(accelData.length).to.equal(dimensions);
          for (let i = 0; i < dimensions; i++) {
            expect(accelData[i]).to.equal(i);
          }
        };
        jamar.once('accelerometer', accelDataFunc);
        jamar.options.sendCounts = true;
        jamar._processProcessSampleData(bufAccelX);
        jamar._processProcessSampleData(bufAccelY);
        jamar._processProcessSampleData(bufAccelZ);
        expect(accelDataFuncCalled).to.be.equal(true);
        jamar.options.sendCounts = false;
        jamar.removeListener('accelerometer', accelDataFunc);
      });
      it('should emit a accel data array with scaled values', function () {
        const bufAccelX = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisX);
        const bufAccelY = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisY);
        const bufAccelZ = jamarSample.sampleCompressedData(k.OBCIJamarAccelAxisZ);
        const expectedXCount = 0;
        const expectedYCount = 1;
        const expectedZCount = 2;
        bufAccelX[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedXCount;
        bufAccelY[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedYCount;
        bufAccelZ[k.OBCIJamarPacket18Bit.auxByte - 1] = expectedZCount;
        const dimensions = 3;
        let accelDataFuncCalled = false;
        const accelDataFunc = (accelData) => {
          accelDataFuncCalled = true;
          expect(accelData.length).to.equal(dimensions);
          for (let i = 0; i < dimensions; i++) {
            expect(accelData[i]).to.equal(i * 0.032);
          }
        };
        jamar.once('accelerometer', accelDataFunc);
        jamar.options.sendCounts = false;
        jamar._processProcessSampleData(bufAccelX);
        jamar._processProcessSampleData(bufAccelY);
        jamar._processProcessSampleData(bufAccelZ);
        expect(accelDataFuncCalled).to.be.equal(true);
        jamar.removeListener('accelerometer', accelDataFunc);
      });
    });
    describe('19bit', function () {
      it('should call proper functions if no dropped packets', function () {
        it('should work on uncompressed data', function () {
          jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
          funcSpyUncompressedData.should.have.been.called;
          funcSpyDroppedPacket.should.not.have.been.called;
        });

        it('should work on compressed data', function () {
          jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.min));
          funcSpyCompressedData.should.have.been.called;
          funcSpyDroppedPacket.should.not.have.been.called;
        });
      });
      it('should recognize packet 101 was dropped', function () {
        // Send the last buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.max));
        funcSpyCompressedData.should.have.been.called;
        const expectedMissedSample = k.OBCIJamarByteIdUncompressed;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyCompressedData.should.have.been.calledTwice;
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should not find a dropped packet on wrap around', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.max - 1));
        funcSpyCompressedData.should.have.been.calledOnce;
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.max));
        funcSpyCompressedData.should.have.been.calledTwice;
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        funcSpyCompressedData.should.have.been.calledTwice;
        funcSpyUncompressedData.should.have.been.calledOnce;
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.min));
        funcSpyCompressedData.should.have.been.calledThrice;
        funcSpyDroppedPacket.should.not.have.been.called;
      });
      it('should recognize dropped packet 199', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.max - 1));
        const expectedMissedSample = k.OBCIJamarByteId19Bit.max;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleUncompressedData();
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should recognize dropped packet 198 and 199', function () {
        jamar._processProcessSampleData(jamarSample.sampleCompressedData(k.OBCIJamarByteId19Bit.max - 2));
        const expectedMissedSample1 = k.OBCIJamarByteId19Bit.max - 1;
        const expectedMissedSample2 = k.OBCIJamarByteId19Bit.max;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleUncompressedData();
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample1);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample2);
      });
      it('should detect dropped packet 101 and process packet 102', function () {
        // Send the raw buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        const expectedMissedSample = k.OBCIJamarByteIdUncompressed + 1;
        // Call the function under test with one more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample);
      });
      it('should detect dropped packet 101 & 1022 and add process packet 103', function () {
        // Send the last buffer, set's jamar._packetCounter
        jamar._processProcessSampleData(jamarSample.sampleUncompressedData());
        const expectedMissedSample1 = k.OBCIJamarByteIdUncompressed + 1;
        const expectedMissedSample2 = k.OBCIJamarByteIdUncompressed + 2;
        // Call the function under test with two more then expected
        const nextPacket = jamarSample.sampleCompressedData(expectedMissedSample2 + 1);
        jamar._processProcessSampleData(nextPacket);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample1);
        funcSpyDroppedPacket.should.have.been.calledWith(expectedMissedSample2);
      });
    });
  });
  describe('_processBytes', function () {
    let funcSpyImpedanceData;
    let funcSpyMultiBytePacket;
    let funcSpyMultiBytePacketStop;
    let funcSpyOtherData;
    let funcSpyProcessedData;

    before(function () {
      // Put watchers on all functions
      funcSpyImpedanceData = sinon.spy(jamar, '_processImpedanceData');
      funcSpyMultiBytePacket = sinon.spy(jamar, '_processMultiBytePacket');
      funcSpyMultiBytePacketStop = sinon.spy(jamar, '_processMultiBytePacketStop');
      funcSpyOtherData = sinon.spy(jamar, '_processOtherData');
      funcSpyProcessedData = sinon.spy(jamar, '_processProcessSampleData');
    });
    beforeEach(function () {
      funcSpyImpedanceData.reset();
      funcSpyMultiBytePacket.reset();
      funcSpyMultiBytePacketStop.reset();
      funcSpyOtherData.reset();
      funcSpyProcessedData.reset();
    });
    it('should route impedance channel 1 packet', function () {
      jamar._processBytes(jamarSample.sampleImpedanceChannel1());
      funcSpyImpedanceData.should.have.been.calledOnce;
    });
    it('should route impedance channel 2 packet', function () {
      jamar._processBytes(jamarSample.sampleImpedanceChannel2());
      funcSpyImpedanceData.should.have.been.calledOnce;
    });
    it('should route impedance channel 3 packet', function () {
      jamar._processBytes(jamarSample.sampleImpedanceChannel3());
      funcSpyImpedanceData.should.have.been.calledOnce;
    });
    it('should route impedance channel 4 packet', function () {
      jamar._processBytes(jamarSample.sampleImpedanceChannel4());
      funcSpyImpedanceData.should.have.been.calledOnce;
    });
    it('should route impedance channel reference packet', function () {
      jamar._processBytes(jamarSample.sampleImpedanceChannelReference());
      funcSpyImpedanceData.should.have.been.calledOnce;
    });
    it('should route multi packet data', function () {
      jamar._processBytes(jamarSample.sampleMultiBytePacket(new Buffer('taco')));
      funcSpyMultiBytePacket.should.have.been.calledOnce;
    });
    it('should route multi packet stop data', function () {
      jamar._processBytes(jamarSample.sampleMultiBytePacketStop(new Buffer('taco')));
      funcSpyMultiBytePacketStop.should.have.been.calledOnce;
    });
    it('should route other data packet', function () {
      jamar._processBytes(jamarSample.sampleOtherData(new Buffer('blah')));
      funcSpyOtherData.should.have.been.calledOnce;
    });
    it('should route processed data packet', function () {
      jamar._processBytes(jamarSample.sampleUncompressedData());
      funcSpyProcessedData.should.have.been.calledOnce;
    });
  });
  it('should emit impedance value', function () {
    let expectedImpedanceValue = 1099;
    const payloadBuf = new Buffer(`${expectedImpedanceValue}${k.OBCIJamarImpedanceStop}`);
    let totalEvents = 0;
    let runningEventCount = 0;

    // Channel 1
    totalEvents++;
    let expectedChannelNumber = 1;
    let impPre = new Buffer([k.OBCIJamarByteIdImpedanceChannel1]);
    let expectedReturnValue = {
      channelNumber: expectedChannelNumber,
      impedanceValue: expectedImpedanceValue
    };
    let dataBuf = Buffer.concat([impPre, payloadBuf]);
    jamar.once('impedance', (actualImpedanceValue) => {
      expect(actualImpedanceValue).to.deep.equal(expectedReturnValue);
      runningEventCount++;
    });
    jamar._processImpedanceData(dataBuf);

    // Channel 2
    totalEvents++;
    expectedChannelNumber = 2;
    impPre[0] = k.OBCIJamarByteIdImpedanceChannel2;
    expectedReturnValue = {
      channelNumber: expectedChannelNumber,
      impedanceValue: expectedImpedanceValue
    };
    dataBuf = Buffer.concat([impPre, payloadBuf]);
    jamar.once('impedance', (actualImpedanceValue) => {
      expect(actualImpedanceValue).to.deep.equal(expectedReturnValue);
      runningEventCount++;
    });
    jamar._processImpedanceData(dataBuf);

    // Channel 3
    totalEvents++;
    expectedChannelNumber = 3;
    impPre[0] = k.OBCIJamarByteIdImpedanceChannel3;
    expectedReturnValue = {
      channelNumber: expectedChannelNumber,
      impedanceValue: expectedImpedanceValue
    };
    dataBuf = Buffer.concat([impPre, payloadBuf]);
    jamar.once('impedance', (actualImpedanceValue) => {
      expect(actualImpedanceValue).to.deep.equal(expectedReturnValue);
      runningEventCount++;
    });
    jamar._processImpedanceData(dataBuf);

    // Channel 4
    totalEvents++;
    expectedChannelNumber = 4;
    impPre[0] = k.OBCIJamarByteIdImpedanceChannel4;
    expectedReturnValue = {
      channelNumber: expectedChannelNumber,
      impedanceValue: expectedImpedanceValue
    };
    dataBuf = Buffer.concat([impPre, payloadBuf]);
    jamar.once('impedance', (actualImpedanceValue) => {
      expect(actualImpedanceValue).to.deep.equal(expectedReturnValue);
      runningEventCount++;
    });
    jamar._processImpedanceData(dataBuf);

    // Channel Reference
    totalEvents++;
    expectedChannelNumber = 0;
    impPre[0] = k.OBCIJamarByteIdImpedanceChannelReference;
    expectedReturnValue = {
      channelNumber: expectedChannelNumber,
      impedanceValue: expectedImpedanceValue
    };
    dataBuf = Buffer.concat([impPre, payloadBuf]);
    jamar.once('impedance', (actualImpedanceValue) => {
      expect(actualImpedanceValue).to.deep.equal(expectedReturnValue);
      runningEventCount++;
    });
    jamar._processImpedanceData(dataBuf);

    // Makes sure the correct amount of events were called.
    expect(runningEventCount).to.equal(totalEvents);
  });

});

xdescribe('#noble', function () {
  xdescribe('#_nobleInit', function () {
    it('should emit powered on', function (done) {
      const jamar = new Jamar({
        verbose: true,
        nobleAutoStart: false,
        nobleScanOnPowerOn: false
      });
      jamar.once(k.OBCIEmitterBlePoweredUp, () => {
        // Able to get powered up thing
        done();
      });
      jamar._nobleInit();
    });
  });
  describe('#_nobleScan', function () {
    const searchTime = k.OBCIJamarBleSearchTime * 2;

    this.timeout(searchTime + 1000);
    it('gets peripherals', function (done) {
      const jamar = new Jamar({
        verbose: true,
        nobleScanOnPowerOn: false
      });

      const doScan = () => {
        jamar._nobleScan(searchTime)
          .then((list) => {
            console.log('listPeripherals', list);
            if (list) done();
          })
          .catch((err) => {
            done(err);
            console.log(err);
          });
      };

      if (jamar._nobleReady()) {
        doScan();
      } else {
        jamar.on('blePoweredOn', doScan());
      }
    });
  });
});
