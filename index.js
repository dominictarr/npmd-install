var fs      = require('fs')
var path    = require('path')
var http    = require('http')
var zlib    = require('zlib')
var os      = require('os')

var mkdirp  = require('mkdirp')
var rimraf  = require('rimraf')
var tar     = require('tar')
var pull    = require('pull-stream')
var pt      = require('pull-traverse')
var paramap = require('pull-paramap')

var unpack  = require('npmd-unpack')

module.exports = function (config) {
  config = config || {}
  var exports = installTree
  //FIX THIS
  var registry = config.registry || 'http://registry.npmjs.org'

  var tmpdir = config.tmp || (os.tmpdir || os.tmpDir)()
  //http://isaacs.iriscouch.com/registry/npm/npm-1.3.1.tgz

  function getUrl (name, ver) {
    return registry +"/" + name + "/" + name + "-" + ver + ".tgz"
  }

  function empty (obj) {
    for(var i in obj)
      return false
    return true
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
      paramap(function (pkg, cb) {
        var target = path.join(tmpdir, Date.now() + '-' + Math.random())
        unpack.unpack(pkg, {target: target, cache: config.cache}, function (err, shasum) {
          if(pkg.shasum && shasum !== pkg.shasum)
            console.error(
              'WARN! expected ' 
            + pkg.name+'@'+pkg.version + 
            + ' to have shasum='+shasum
            )
          pkg.tmp = path.join(target, 'package')
          cb(err, pkg)
        })
      }, 64),
      pull.asyncMap(function (pkg, cb) {
        if(!pkg.tmp)
          return cb(new Error('no path for:'+ pkg.name), null)

        var source = pkg.tmp
        var dest   = path.join(pkg.path, pkg.name)
        mkdirp(pkg.path, function () {
          fs.lstat(dest, function (err) {
            if(!err) return cb(null, null)
            fs.rename(source, dest, function (err) {
              console.error(pkg.name + '@' + pkg.version, '->', pkg.path)
              cb(err, null)
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
        }, function (err, val) {
          cb(err, val)
        })
      })
      return true
    })
  }

  exports.db = function () {}

  return exports
}

