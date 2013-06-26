
var request = require('request')
var fs      = require('fs')
var toPull  = require('stream-to-pull-stream')
var path    = require('path')
var mkdirp  = require('mkdirp')
var pull    = require('pull-stream')
var http    = require('http')
var tar     = require('tar')
var tee     = require('pull-tee')
var zlib    = require('zlib')
var os      = require('os')
var rimraf  = require('rimraf')
var pt      = require('pull-traverse')
var through = require('through')

var registry = 'http://registry.npmjs.org'

function getUrl (name, ver) {
  return registry +"/" + name + "/-/" + name + "-" + ver + ".tgz"
}

function empty (obj) {
  for(var i in obj)
    return false
  return true
}

var preparePackage = exports.preparePackage =
function (pkg, cb) {
//  if(/^(git|http)/.test(pkg.from))
//    console.error('FROM', pkg.from)
  if(!pkg.version)
    return cb(new Error(pkg.name + ' has no version'))

  var name = pkg.name
  var ver  = pkg.version
  var cache = path.join(process.env.HOME, '.npm', name, ver, 'package.tgz')
  var tmp = path.join(os.tmpdir(), ''+Date.now() + Math.random())

  fs.stat(cache, function (err) {

    var createStream = !err
    ? function (cb) { cb(null, fs.createReadStream(cache)) }
    : function (cb) {
      mkdirp(path.dirname(cache), function () {
        http.get(getUrl(name, ver), function (res) {      
          res.pipe(fs.createWriteStream(cache))
          cb(null, res)
        })
      })
    }

    mkdirp(tmp, function (err) {
      if(err) return cb(err)
      createStream(function (err, stream) {
        var i = 1
        stream.on('error', next)
        stream.pipe(zlib.createGunzip())
        .pipe(tar.Extract({path: tmp}))
        .on('end', next)
        function next (err) {
          if(--i) return
          cb(err, tmp)
        }
      })
    })

  })
}

var installTree = exports.installTree =
function (tree, opts, cb) {
  if(!cb)
    cb = opts, opts = {}

  tree.path = path.join(opts.path || process.cwd(), 'node_modules')

  pull(
    pt.widthFirst(tree, function (pkg) {
      return pull(
        pull.values(pkg.dependencies),
        pull.map(function (_pkg) {
          _pkg.path = path.join(pkg.path, pkg.name, 'node_modules')
          return _pkg
        })
      )
    }),
    //unpack every file, so that it can be moved into place.
    //optimization: if a module has no deps,
    //just link it.
    pull.asyncMap(function (pkg, cb) {
      preparePackage(pkg, function (err, data) {
        pkg.tmp = data
        cb(err, pkg)
      })
    }, 64),
    pull.asyncMap(function (pkg, cb) {
      if(!pkg.tmp)
        return cb(new Error('no path for:'+ pkg.name))

      var source = path.join(pkg.tmp, 'package')
      var dest   = path.join(pkg.path, pkg.name)
      mkdirp(pkg.path, function () {
        fs.lstat(dest, function (err) {
          if(!err) return cb()
          fs.rename(source, dest, function (err) {
            console.error(pkg.name + '@' + pkg.version, '->', pkg.path)
            cb(err)
          })
        })
      })
    }),
    pull.drain(null, cb)
  )

}

exports = module.exports = installTree

exports.commands = function (db, config) {
  db.commands.install = function (config, cb) {
    db.resolve(config._[0], {greedy: config.greedy}, function (err, tree) {
      if(err) return cb(err)
      installTree(tree, {path: config.installPath}, cb)
    })
  }
}

exports.db = function () {}

if(!module.parent) {
  var snapshot = require('./npmd-snapshot.json')
  installTree(snapshot, function (err) {
    if(err) throw err
    console.log('done')
  })
}


