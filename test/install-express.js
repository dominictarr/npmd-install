var install = require('./setup')
var tape = require('tape')
var snapshot = require('./express.json')
var join = require('path').join
require('rimraf').sync(join(__dirname, 'node_modules'))

tape('install express', function (t) {
  install(snapshot, {path: __dirname}, function (err) {
    if(err) throw err
    console.log('done')
    var reqPkg = require('./node_modules/express/package.json')
    t.deepEqual(reqPkg.name, snapshot.name)
    //this is weird, but that's npm for you.
    t.deepEqual(reqPkg.version, snapshot.version.replace('-', ''))
    t.end()
  })
})


