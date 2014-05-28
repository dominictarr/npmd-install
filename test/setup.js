//just init the cache for tests

var config = require('npmd-config')
var level = require('level')
var cache = require('npmd-cache')
    (level(config.dbPath, {encoding:'json'}), config)

module.exports = require('../')(cache)

