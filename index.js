
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

function toGithubDownload (repo) {
  //git://github.com/substack/sockjs-client.git#browserify-npm
  //https://github.com/isaacs/readable-stream/archive/master.tar.gz
  if(/^http/.test(repo)) return repo

  var m = /^git:\/\/(github.com\/[^#]+)(?:#(.*))?$/.exec(repo)

  if(m) return 'https://' + m[1] + '/archive/' + m[2] + '.tar.gz'
  return null
}

function download (name, ver) {
  var ds = pull.defer()
  return ds
}

//function fromCache (name, ver) {
//  var package = path.join(process.env.HOME, '.npm', name, ver, 'package.tgz')
//  return pfs.read(package)
//}

var fromCache, extract, intsall

var exports = install = module.exports =
function (pkg, cb) {
  if(!pkg.version) {
    return process.nextTick(cb)
  }
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
        stream.pipe(zlib.createGunzip())
        .pipe(tar.Extract({path: tmp}))
        .on('end', function () {
          cb(null, tmp)
        })
      })
    })

  })
}

if(!module.parent) {

  ///*
  var snapshot = require('./npmd-snapshot.json')
  snapshot.path = path.join(process.cwd(), 'node_modules')
  var i = 0

  pull(
    pt.widthFirst(snapshot, function (pkg) {
      return pull(
        pull.values(pkg.dependencies),
        pull.map(function (_pkg) {
          _pkg.path = path.join(pkg.path, pkg.name, 'node_modules')
          return _pkg
        })
      )
    }),
    pull.paraMap(function (pkg, cb) {
      console.log(pkg.name + '@' + pkg.version, '->', pkg.path)
      install(pkg, function (err, data) {
        console.log('installed', err, pkg.name, i++)
        pkg.tmp = data
        cb(err, pkg)
      })
    }, 64),
    pull.asyncMap(function (pkg, cb) {
      if(!pkg.tmp) {
        console.log('NO PATH NO PATH', pkg.name)
        return cb(new Error('no path'))
      }
      console.error(pkg.path)
      var source = path.join(pkg.tmp, 'package')
      var dest   = path.join(pkg.path, pkg.name)
      mkdirp(pkg.path, function () {
        fs.stat(dest, function (err) {
            if(!err) {
              return cb()
            }
            fs.rename(source, dest, cb)
          })
        })
    }),
    pull.drain(null, function (err) {
      if(err) throw err
      console.log('DONE')
    })
  )

}
