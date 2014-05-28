
var install = require('./setup')

var tape = require('tape')
var join = require('path').join

require('rimraf').sync(join(__dirname, 'node_modules'))

tape('install foo bar', function (t) {

  var snapshot = require('./foo-bar.json')
  install(snapshot, {path: __dirname}, function (err) {
    if(err) throw err
    console.log('done')

    var fooPkg = require('./node_modules/foo/package.json')
    var barPkg = require('./node_modules/bar/package.json')
    t.equal(fooPkg.name,    snapshot.foo.name)
    t.equal(fooPkg.version, snapshot.foo.version)
    t.equal(barPkg.name,    snapshot.bar.name)
    t.equal(barPkg.version, snapshot.bar.version)
    t.end()
  })

})
