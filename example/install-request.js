var installTree = require('../')

var snapshot = require('./request-dep-tree.json')
installTree(snapshot, function (err) {
  if(err) throw err
  console.log('done')
})


