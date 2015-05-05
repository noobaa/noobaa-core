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
    var self = this;
    EventEmitter.call(self);
    self.rpc = rpc;
    self.url = address_url;

    // each connection keeps timestamp + random that are taken at connect time
    // which are used to identify this connection by both ends.
    // for udp connections this will also allow to detect the case when one
    // of the sides crashes and the connection is dropped without communicating.
    // in such case all pending requests will need to be rejected
    // and retried on new connection.
    self.time = time || Date.now();
    self.rand = rand || chance.integer(CONN_RAND_CHANCE);
    self.connid = self.url.href +
        '/' + self.time.toString(16) +
        '.' + self.rand.toString(16);

    self.transport = TRANSPORTS[self.url.protocol] || rpc_ws;
    if (self.transport.singleplex) {
        self.singleplex = self.transport.singleplex;
        dbg.log1('RPC CONNECTION', self.url.href);
    } else {
        dbg.log0('RPC CONNECTION', self.url.href);
    }

    self.on('error', function(err) {
        dbg.error('RPC connection ERROR:', self.connid, err.stack || err);
        self.close();
    });
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
    this.rpc.connection_close(this);
    return this.transport.close(this);
};

/**
 *
 */
RpcConnection.prototype.receive = function(message) {
    return this.rpc.connection_receive_message(this, message);
};

/**
 *
 */
RpcConnection.prototype.send_signal = function(message) {
    return this.rpc.connection_send_signal(this, message);
};

/**
 *
 */
RpcConnection.prototype.receive_signal = function(message, signal_socket) {
    if (this.transport.receive_signal) {
        return this.transport.receive_signal(this, message, signal_socket);
    }
};
