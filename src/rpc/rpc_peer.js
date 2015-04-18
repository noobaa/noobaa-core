'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var buffer_utils = require('../util/buffer_utils');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);
var SignalClient = require('./signal_client');

dbg.set_level(config.dbg_log_level);

module.exports = {
    request: request,
    serve: serve,
};

/**
 *
 * request
 *
 * send rpc request to peer
 *
 */
function request(rpc, api, method_api, params, options) {

}


/**
 *
 * serve
 *
 * start serving rpc requests
 *
 */
function serve(rpc, peer_id) {

    rpc.signalClient = new SignalClient(peer_id);

}
