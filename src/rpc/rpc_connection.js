'use strict';

// var _ = require('lodash');
// var Q = require('q');
var util = require('util');
var url = require('url');
var dbg = require('noobaa-util/debug_module')(__filename);
var EventEmitter = require('events').EventEmitter;
// var promise_utils = require('../util/promise_utils');
var rpc_http = require('./rpc_http');
var rpc_ws = require('./rpc_ws');
var rpc_nb = require('./rpc_nb');
var rpc_local = require('./rpc_local');

module.exports = RpcConnection;

var TRANSPORTS = {
    'http:': rpc_http,
    'https:': rpc_http,
    'ws:': rpc_ws,
    'wss:': rpc_ws,
    'nb:': rpc_nb,
    'nbs:': rpc_nb,
    'localrpc:': rpc_local,
};

util.inherits(RpcConnection, EventEmitter);

/**
 *
 */
function RpcConnection(address) {
    EventEmitter.call(this);
    this.address = address;
    this.url = url.parse(address);
    this.transport = TRANSPORTS[this.url.protocol || 'localrpc:'];
    if (!this.transport) {
        throw new Error('PROTOCOL NOT SUPPORTED ' + this.address);
    }
    this.reusable = this.transport.reusable;
    dbg.log1('NEW CONNECTION', this.address);
}

/**
 *
 */
RpcConnection.prototype.connect = function() {
    return this.transport.connect(this);
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
RpcConnection.prototype.send = function(msg, op, reqid) {
    return this.transport.send(this, msg, op, reqid);
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
    if (this.transport.close) {
        this.transport.close(this);
    }
};
