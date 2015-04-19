'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var buffer_utils = require('../util/buffer_utils');
var config = require('../../config.js');
var dbg = require('noobaa-util/debug_module')(__filename);
var SignalClient = require('./signal_client');
var WS = require('ws');
var SimpleWS = require('./simple_ws');

dbg.set_level(config.dbg_log_level);

module.exports = {
    connect: connect
};


/**
 *
 * connect
 *
 * start a ws connection to the server
 *
 */
function connect(conn) {
    if (conn._ws) {
        return;
    }
    conn._ws = new SimpleWS({
        address: conn.address,
        onclose: function() {
            conn._ws = null;
            connect(conn);
        },
        keepalive: {
            create: function() {},
            delay: 10000,
        },
        handshake: {
            create: function() {
                return conn.peer_id;
            }
        },
        handler: conn._handle_message.bind(conn),
    });
    return conn._ws.connect();
}

function RpcWS() {}

/**
 *
 * serve
 *
 * start serving rpc requests
 *
 */
RpcWS.prototype.serve = function() {
    var self = this;

    self._wss = new SimpleWS.Server({
        connHandler: function() {},
        connCloseHandler: function() {},
        keepalive: {},
        handshake: {
            accept: self._handle_handshake.bind(self),
        },
        handler: self._handle_message.bind(self),
    });
};


/**
 *
 * send_request
 *
 * send rpc request over the ws
 *
 */
RpcWS.prototype.send_request = function(req) {
    var self = this;
    self._ws.send({
        content: 'rpc.req',
        req: req.get_req_json()
    });
};


RpcWS.prototype._handle_handshake = function(msg) {
    // TODO ...
};


RpcWS.prototype._handle_message = function(msg) {
    var self = this;
    switch (msg.content) {
        case 'rpc.req':
            return self._handle_request.bind(self, msg);
        case 'rpc.res':
            return self._handle_response.bind(self, msg);
        case 'rpc.sig':
            return self._handle_signal.bind(self, msg);
        default:
            // TODO ...
            break;
    }
};

RpcWS.prototype._handle_request = function(msg) {
    var self = this;
    return self._rpc.handle_request(msg.req)
        .then(function(reply) {
            return {
                content: 'rpc.res',
                reqid: msg.req.reqid,
                rand: msg.req.rand,
                reply: reply
            };
        }, function(err) {
            return {
                content: 'rpc.res',
                reqid: msg.req.reqid,
                rand: msg.req.rand,
                error: err
            };
        });
};

RpcWS.prototype._handle_response = function(msg) {
    var req = this._rpc._request_cache[msg.reqid];
    if (!req) {
        // TODO ...
    }
    if (msg.rand !== req.rand) {
        // TODO ...
    }
    if (msg.error) {
        req.defer.reject(msg.error);
    } else {
        req.defer.resolve(msg.reply);
    }
};

RpcWS.prototype._handle_signal = function(msg) {
    var target = this._signal_targets[msg.signal_id];
    if (!target) {
        switch (msg.signal) {
            case 'webrtc':
                target = this._signal_targets[msg.signal_id] = new SimplePeer();
                break;
            case 'ice':
                target = this._signal_targets[msg.signal_id] = new ICEPeer();
                break;
            default:
                // TODO ...
                break;
        }
    }
    target.signal(msg.signal_data);
};
