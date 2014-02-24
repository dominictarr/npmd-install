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
var clone   = require('clone')

var EventEmitter = require('events').EventEmitter

function empty (obj) {
  for(var i in obj)
    return false
  return true
}

function emptyStream () {
  return function (abort, cb) {
    cb(true)
  }
}

function map (ob, iter) {
  if(Array.isArray(ob)) return ob.map(iter)
  var a = {}
  for(var k in ob)
    a[k] = iter(ob[k], k, ob)
  return a
}

function merge (a, b) {
  for(var k in b)
    if(!a[k])
      a[k] = b[k]
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
      if(!pkg.dependencies)
        return emptyStream()
      
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
      unpack.unpack(pkg,
        merge({target: target, cache: opts.cache}, opts),
        function (err, shasum) {
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
          if(stat) fs.rename(dest, randDir('npmd-gc-') , next)
          else     next()

          function next (err) {
            if(err) return cb(err)
            fs.rename(source, dest, function (err) {
              if(err)
                err.stack = err.message
                  + '\n(mv ' + source + ' ' + dest + ')'
                  + '\n' + err.stack
              cb(err, null)
            })
          }
        })
      })
    }),
    pull.drain(null, cb)
  )

})


function clean(tree) {

  function _clean (tree) {
    if(!tree) return tree
    delete tree.dependencies
    delete tree.devDependencies
    delete tree.optionalDependencies
    delete tree.peerDependencies
    return tree
  }

  if('string' === typeof tree.name)
    return _clean(tree)

  for(var k in tree)
    _clean(tree[k])

  return tree
}


var install = exports =  module.exports =
cont.to(function (tree, opts, cb) {
  if(!cb) cb = opts, opts = {}

  if('string' === typeof tree.name)
    return installTree(tree, opts) (next)

  cpara(map(tree, function (tree) {
    return installTree(tree, opts)
  })) (next)

  function next (err) {
    cb(err, clean(clone(tree)))
  }
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
    var tree = JSON.parse(b)
    install(tree, config, function (err, installed) {
      if(err) throw err
        console.log(JSON.stringify(installed, null, 2))
    })
  })
}

