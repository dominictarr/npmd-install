var install = require('./setup')
var tape = require('tape')
var snapshot = require('./request-dep-tree.json')
var join = require('path').join
require('rimraf').sync(join(__dirname, 'node_modules'))

tape('install request', function (t) {
  install(snapshot, {path: __dirname}, function (err) {
    if(err) throw err
    console.log('done')
    var reqPkg = require('./node_modules/request/package.json')
    t.deepEqual(reqPkg.name, snapshot.name)
    t.deepEqual(reqPkg.version, snapshot.version)
    t.end()
  })
})


