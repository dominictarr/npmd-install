var fs      = require('fs')
var path    = require('path')
var http    = require('http')
var zlib    = require('zlib')
var os      = require('os')

var request = require('request')
var mkdirp  = require('mkdirp')
var rimraf  = require('rimraf')
var tar     = require('tar')
var pull    = require('pull-stream')
var pt      = require('pull-traverse')


module.exports = function (config) {
  var exports = installTree
  //FIX THIS
  var registry = config.registry || 'http://registry.npmjs.org'

  var tmpdir = config.tmp || os.tmpdir()

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
    if(!pkg.version)
      return cb(new Error(pkg.name + ' has no version'))

    var name = pkg.name
    var ver  = pkg.version
    //SHOULD COME FROM CONFIG
    var cache = path.join(process.env.HOME, '.npm', name, ver, 'package.tgz')
    var tmp = path.join(tmpdir, ''+Date.now() + Math.random())

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

  exports.installTree = installTree
  function installTree (tree, opts, cb) {
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

  //exports = module.exports = installTree

  exports.commands = function (db, config) {
    db.commands.push(function (db, config, cb) {
      var args = config._.slice()
      if('install' !== args.shift()) return

      db.resolve(args.shift(), config, function (err, tree) {
        if(err) return cb(err)
        installTree(tree, {
          path: config.installPath, tmp: config.tmp
        }, cb)
      })
      return true
    })
  }

  exports.db = function () {}

  return exports
}

