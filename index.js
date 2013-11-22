#! /usr/bin/env node

var fs      = require('fs')
var path    = require('path')
var os      = require('osenv')

var mkdirp  = require('mkdirp')
var pull    = require('pull-stream')
var pt      = require('pull-traverse')
var paramap = require('pull-paramap')
var cont    = require('continuable')
var cpara   = require('continuable-hash')
var unpack  = require('npmd-unpack')
var deps    = require('get-deps')

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

var tmpdir = os.tmpdir()

function randDir (pre) {
  return path.join(tmpdir, (pre || '') + Date.now() + '-' + Math.random())
}

var installTree = cont.to(function(tree, opts, cb) {
  if(!cb)
    cb = opts, opts = {}

  //this only works on unix. in practice, you must pass in the config object.
  var cache = opts.cache || path.join(process.env.HOME, '.npm')

  var installPath = opts.path || process.cwd()

  tree.path = path.join(installPath, 'node_modules')

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
    //possibe optimization: if a module has no deps,
    //just link it.
    paramap(function (pkg, cb) {
      var target = randDir('npmd-unpack-')
      unpack.unpack(pkg, {target: target, cache: opts.cache}, function (err, shasum) {
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
        fs.lstat(dest, function (err, stat) {
          if(stat)
            fs.rename(dest ,randDir('npmd-gc-') , next)
          else next()

          function next (err) {
            if(err) return cb(err)
            fs.rename(source, dest, function (err) {
                path.relative(installPath, path.join(pkg.path, pkg.name))
              if(err) {
                err.stack = err.message + '\n(mv ' + source + ' ' + dest + ')' + '\n' + err.stack
              }
              cb(err, null)
            })
          }
        })
      })
    }),
    pull.drain(null, cb)
  )

})


var install = exports =  module.exports =
cont.to(function (tree, opts, cb) {
  if(!cb) cb = opts, opts = {}

  if('string' === typeof tree.name)
    return installTree(tree, opts) (cb)

  cpara(map(tree, function (tree) {
    return installTree(tree, opts)
  })) (cb)
})

//process.on is test for !browserify
if(!module.parent && process.on) {
  var config = require('npmd-config')

  if(config.version) {
    console.log(require('./package').version)
    process.exit(0)
  }

  var b = ''
  process.stdin.on('data', function (data) {
    b += data.toString()
  })
  .on('end', function () {
    install(JSON.parse(b), config, function (err) {
      if(err) throw err
    })
  })
}

