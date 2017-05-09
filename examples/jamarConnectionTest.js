let Jamar = require('./Jamar')
// let id = 'Jamar60441'

Jamar.discover(function(jamarInstance) {
  // you can be notified of disconnects
  jamarInstance.on('disconnect', function() {
    console.log('we got disconnected!')
  })
  // you'll need to call connect and set up
  jamarInstance.connectAndSetUp(function(error) {
    console.log('were connected!')

  jamarInstance.receive(function(error, data) {
    console.log('got data: ' + data);
    })

  })
})
