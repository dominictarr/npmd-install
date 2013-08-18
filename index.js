var fs      = require('fs')
var path    = require('path')
var http    = require('http')
var zlib    = require('zlib')
var os      = require('osenv')

var mkdirp  = require('mkdirp')
var rimraf  = require('rimraf')
var tar     = require('tar')
var pull    = require('pull-stream')
var pt      = require('pull-traverse')
var paramap = require('pull-paramap')
var cont    = require('continuable')
var cpara   = require('continuable-hash')
var unpack  = require('npmd-unpack')
var deps    = require('get-deps')
var linkBin = require('npmd-bin')

var EventEmitter = require('events').EventEmitter

function empty (obj) {
  for(var i in obj)
    return false
  return true
}

function map (ob, iter) {
  if(Array.isArray(ob)) return ob.map(iter)
  var a = {}
  for(var k in ob)
    a[k] = iter(ob[k], k, ob)
  return a
}


module.exports = function (config) {
  config = config || {}
  //FIX THIS

  var registry = config.registry || 'http://registry.npmjs.org'

  var tmpdir = os.tmpdir()
  //http://isaacs.iriscouch.com/registry/npm/npm-1.3.1.tgz

  function getUrl (name, ver) {
    return registry +"/" + name + "/" + name + "-" + ver + ".tgz"
  }

  var installTree = cont.to(function(tree, opts, cb) {
    if(!cb)
      cb = opts, opts = {}

    var installPath = opts.path || process.cwd()
    tree.path = path.join(installPath, 'node_modules')
    console.log(opts)
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
            + pkg.name+'@'+pkg.version
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
              console.error(pkg.name + '@' + pkg.version, '->',
                path.relative(installPath, path.join(pkg.path, pkg.name)))
              if(err) {
                
                err.stack = err.message + '\n(mv ' + source + ' ' + dest + ')' + '\n' + err.stack
              }
              cb(err, null)
            })
          })
        })
      }),
      pull.drain(null, cb)
    )

  })

  exports = installTree

  var installAll = exports.installAll =
  
  cont.to(function (tree, opts, cb) {
    if(!cb) cb = opts, opts = {}
    if('string' === typeof tree.name)
      return installTree(tree, opts) (cb)

    cpara(map(tree, function (tree) {
      return installTree(tree, opts) 
    })) (cb)
  })

  exports.commands = function (db, config) {
    db.commands.push(function (db, config, cb) {
      var args = config._.slice()
      if('install' !== args.shift()) return

      if(!config.path && config.global)
        config.path = config.prefix

      if(!config.bin)
        config.bin = config.global 
          ? path.join(config.prefix, 'lib', 'bin')
          : path.join(config.path || process.cwd(), 'node_modules', '.bin')

      if(!args.length)
        args = deps(process.cwd(), config)

      db.resolve(args, config, function (err, tree) {
        if(err) return cb(err)
        if('string' === typeof tree.name)
          installTree(tree, config) (cb)
        else
          installAll(tree, config, function (err, val) {
            cb(err, val)
          })
      })
      return true
    })
  }

  exports.db = function () {}

  return exports
}

