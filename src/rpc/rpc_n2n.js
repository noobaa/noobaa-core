'use strict';

module.exports = RpcN2NConnection;
RpcN2NConnection.Agent = RpcN2NAgent;

// var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var url = require('url');
var dbg = require('../util/debug_module')(__filename);
// var js_utils = require('../util/js_utils');
// var time_utils = require('../util/time_utils');
var native_core = require('../util/native_core');
var EventEmitter = require('events').EventEmitter;
var RpcBaseConnection = require('./rpc_base_conn');
var Ice = require('./ice');

// dbg.set_level(5, 'core.rpc');

util.inherits(RpcN2NConnection, RpcBaseConnection);

/**
 *
 * RpcN2NConnection
 *
 * n2n - node-to-node or noobaa-to-noobaa, essentially p2p, but noobaa branded.
 *
 */
function RpcN2NConnection(addr_url, n2n_agent) {
    var self = this;
    RpcBaseConnection.call(self, addr_url);
    self.n2n_agent = n2n_agent;

    var Nudp = native_core().Nudp;
    self.nudp = new Nudp();
    self.nudp.on('close', function() {
        self.close();
    });
    self.nudp.on('message', function(msg) {
        dbg.log1('N2N RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
        self.emit('message', msg);
    });
    self.nudp.on('stun', function(buffer, port, address) {
        // when received stun message (detected by packet type in native nudp module)
        // we let the ice module handle it
        self.ice.handle_stun_packet(buffer, {
            port: port,
            address: address
        });
    });

    self.ice = new Ice();
    self.ice.sender = function(buffer, port, address) {
        // ice messages are sent outbound so they can bypass dtls and utp
        return P.ninvoke(self.nudp, 'send_outbound', buffer, port, address);
    };
    self.ice.signaller = function(info) {
        // ice requires a signaller callback that can transmit a short message to the peer
        // in order to decide how to traverse NAT.
        return self.n2n_agent.signaller({
            target: self.url.href,
            info: info
        });
    };

    // setInterval(function() { dbg.log2('N2N STATS', self.nudp.stats()); }, 5000);
}

RpcN2NConnection.prototype._connect = function() {
    var self = this;
    dbg.log1('N2N connect', self.url.href);
    return P.fcall(function() {
            return P.ninvoke(self.nudp, 'bind', 0, '0.0.0.0');
        })
        .then(function(port) {
            return self.ice.connect(port);
        })
        .then(function(target) {
            return P.ninvoke(self.nudp, 'connect', target.port, target.address);
        });
};

/**
 * accept ICE signal and attempt to open connection to peer.
 * takes the peer's ICE cadidates info, and returns the local ICE info
 * to be delivered back to the peer over the signal channel.
 */
RpcN2NConnection.prototype.accept = function(info) {
    var self = this;
    return P.fcall(function() {
            return P.ninvoke(self.nudp, 'bind', 0, '0.0.0.0');
        })
        .then(function(port) {
            return self.ice.accept(port, info);
        });
};

RpcN2NConnection.prototype._close = function(err) {
    this.nudp.close();
    this.ice.close();
};

RpcN2NConnection.prototype._send = function(msg) {
    // msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
    return P.ninvoke(this.nudp, 'send', msg);
};


/**
 *
 * RpcN2NAgent
 *
 * represents an end-point for N2N connections.
 * it will be used to accept new connections initiated by remote peers,
 * and also when initiated locally to connect to a remote peer.
 *
 */
function RpcN2NAgent(options) {
    EventEmitter.call(this);
    options = options || {};
    this.signaller = options.signaller;
}

util.inherits(RpcN2NAgent, EventEmitter);

RpcN2NAgent.prototype.signal = function(params) {
    var self = this;
    dbg.log0('N2N AGENT signal:', params);

    // TODO target address is me, should use the source address but we don't send it ...

    var addr_url = url.parse(params.target, true);
    var conn = new RpcN2NConnection(addr_url, self);
    return conn.accept(params.info)
        .tap(function() {
            // once accept returns it means we have connected
            conn.connected_promise = P.resolve();
            self.emit('connection', conn);
        });
};
