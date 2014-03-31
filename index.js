#! /usr/bin/env node

var fs      = require('fs')
var path    = require('path')
var os      = require('osenv')
var crypto  = require('crypto')

var mkdirp  = require('mkdirp')
var pull    = require('pull-stream')
var pt      = require('pull-traverse')
var paramap = require('pull-paramap')
var cont    = require('continuable')
var cpara   = require('continuable-hash')

//var _unpack  = require('npmd-unpack').unpack
var deps    = require('get-deps')
var clone   = require('clone')
var tarfs   = require('tar-fs')
var zlib    = require('zlib')


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



var inject = module.exports = function (cache) {

  function unpack (pkg, opts, cb) {
    var start = Date.now()

    //get from the hash if it's already been downloaded!
    //else download from the registry or the url.
    var query = {
      key: /\//.test(pkg.from) ? pkg.from : pkg.name + '@' + pkg.version,
      hash: pkg.shasum
    }

    return cache.createStream(query, function (err, stream) {
      if(err) return cb(err)
      if(!stream) throw new Error('did not return stream')
      var hash = crypto.createHash(opts.alg || 'sha1')

      stream
        .on('data', function (d) { hash.update(d) })
        .on('error', cb)
        .pipe(zlib.createGunzip())
        .pipe(tarfs.extract(opts.target))
        .on('finish', function () {
          cb(null, hash.digest('hex'))
        })
    })
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
      paramap(function (pkg, cb) {
        unpack(pkg, {target: pkg.path, alg: config.alg}, function (err, hash) {
            if(hash !== pkg.shasum) return cb(new Error(
              'expected ' + pkg.name +'@' + pkg.version +'\n' +
              'to have shasum=' + pkg.shasum + ' but was='+hash))
            cb(err, pkg)
        })
      }, 32),
      pull.drain(null, cb)
    )

  })

  return cont.to(function (tree, opts, cb) {
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

}

//process.on is test for !browserify
if(!module.parent && process.on) {
  var config = require('npmd-config')
  var cache = require('npmd-cache')(config)
  var install = inject(cache)

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

