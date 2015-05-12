'use strict';

// var _ = require('lodash');
// var Q = require('q');
var util = require('util');
// var url = require('url');
var chance = require('chance').Chance(Date.now());
var dbg = require('noobaa-util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
// var promise_utils = require('../util/promise_utils');
var rpc_http = require('./rpc_http');
var rpc_ws = require('./rpc_ws');
var rpc_nudp = require('./rpc_nudp');
var rpc_fcall = require('./rpc_fcall');

module.exports = RpcConnection;

var TRANSPORTS = {
    'http:': rpc_http,
    'https:': rpc_http,
    'ws:': rpc_ws,
    'wss:': rpc_ws,
    'nudp:': rpc_nudp,
    'nudps:': rpc_nudp,
    'fcall:': rpc_fcall,
};
var UINT32_MAX = (1 << 16) * (1 << 16) - 1;
var CONN_RAND_CHANCE = {
    min: 1,
    max: UINT32_MAX
};


util.inherits(RpcConnection, EventEmitter);

/**
 *
 */
function RpcConnection(rpc, address_url, time, rand) {
    EventEmitter.call(this);
    this.rpc = rpc;
    this.url = address_url;

    // each connection keeps timestamp + random that are taken at connect time
    // which are used to identify this connection by both ends.
    // for udp connections this will also allow to detect the case when one
    // of the sides crashes and the connection is dropped without communicating.
    // in such case all pending requests will need to be rejected
    // and retried on new connection.
    this.time = time || Date.now();
    this.rand = rand || chance.integer(CONN_RAND_CHANCE);
    this.connid = this.url.href +
        '/' + this.time.toString(16) +
        '.' + this.rand.toString(16);

    this.transport = TRANSPORTS[this.url.protocol] || rpc_ws;
    if (this.transport.singleplex) {
        this.singleplex = this.transport.singleplex;
        dbg.log1('RPC CONNECTION', this.url.href);
    } else {
        dbg.log0('RPC CONNECTION', this.url.href);
    }
}

/**
 *
 */
RpcConnection.prototype.connect = function(options) {
    return this.transport.connect(this, options);
};

/**
 *
 */
RpcConnection.prototype.authenticate = function(auth_token) {
    return this.transport.authenticate(this, auth_token);
};

/**
 *
 */
RpcConnection.prototype.send = function(msg, op, req) {
    return this.transport.send(this, msg, op, req);
};

/**
 * should be overriden by rpc
 */
RpcConnection.prototype.receive = function(msg) {
    dbg.error('NO CONNECTION RECEIVER');
};

/**
 *
 */
RpcConnection.prototype.close = function() {
    this.emit('close');
    return this.transport.close(this);
};
