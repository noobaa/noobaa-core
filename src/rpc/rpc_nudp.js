'use strict';

module.exports = RpcNudpConnection;

// var _ = require('lodash');
var P = require('../util/promise');
// var url = require('url');
var util = require('util');
var RpcBaseConnection = require('./rpc_base_conn');
var native_core = require('../util/native_core');
var stun = require('./stun');
// var promise_utils = require('../util/promise_utils');
// var dbg = require('../util/debug_module')(__filename);

util.inherits(RpcNudpConnection, RpcBaseConnection);

/**
 *
 * RpcNudpConnection
 *
 */
function RpcNudpConnection(addr_url) {
    RpcBaseConnection.call(this, addr_url);
}

/**
 *
 * connect
 *
 */
RpcNudpConnection.prototype._connect = function() {
    var self = this;
    var Nudp = native_core().Nudp;
    self.nudp = new Nudp();
    self._init_nudp();
    return P.ninvoke(self.nudp, 'bind', 0, '0.0.0.0')
        .then(function(port) {
            return P.ninvoke(self.nudp, 'connect', self.url.port, self.url.hostname);
        })
        .then(function() {
            // send stun request just for testing
            return P.ninvoke(self.nudp, 'send_outbound', stun.new_packet(stun.METHODS.REQUEST), self.url.port, self.url.hostname);
        })
        .then(function() {
            self.emit('connect');
        })
        .fail(function(err) {
            self.emit('error', err);
        });
};

/**
 *
 * close
 *
 */
RpcNudpConnection.prototype._close = function() {
    if (this.nudp) {
        this.nudp.close();
    }
};

/**
 *
 * send
 *
 */
RpcNudpConnection.prototype._send = function(msg) {
    return P.ninvoke(this.nudp, 'send', msg);
};

/**
 *
 * accept
 *
 */
RpcNudpConnection.prototype.accept = function(port) {
    var self = this;
    var Nudp = native_core().Nudp;
    self.nudp = new Nudp();
    self._init_nudp();
    return P.ninvoke(self.nudp, 'bind', port, '0.0.0.0')
        .then(function(port) {
            // TODO emit event from native code?
            return P.delay(1000);
        })
        .then(function() {
            self.emit('connect');
        })
        .fail(function(err) {
            self.emit('error', err);
        });
};


RpcNudpConnection.prototype._init_nudp = function() {
    var self = this;
    var nudp = self.nudp;

    nudp.on('close', function() {
        self.emit('error', new Error('NUDP CLOSED'));
    });

    nudp.on('error', function(err) {
        self.emit('error', err);
    });

    nudp.on('message', function(msg) {
        self.emit('message', msg);
    });

    nudp.on('stun', function(buffer, rinfo) {
        console.log('STUN:', rinfo, buffer);
    });
};
