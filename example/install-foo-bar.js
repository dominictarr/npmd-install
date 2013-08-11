var installAll = require('../')({}).installAll

var snapshot = require('./foo-bar.json')
installAll(snapshot, function (err) {
  if(err) throw err
  console.log('done')
})

