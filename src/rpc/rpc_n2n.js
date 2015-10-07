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
// var promise_utils = require('../util/promise_utils');
var url_utils = require('../util/url_utils');
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
    self.ice = new Ice(self.connid, {
        udp_socket: function() {
            var nudp = new Nudp();
            return P.ninvoke(nudp, 'bind', 0, '0.0.0.0').then(function(port) {
                nudp.port = port;
                return nudp;
            });
        },
        tcp_active: true,
        tcp_passive: true,
        tcp_so: true,
        tcp_secure: true,
        signaller: function(info) {
            // send ice info to the peer over a relayed signal channel
            // in order to coordinate NAT traversal.
            return self.n2n_agent.signaller({
                target: self.url.href,
                info: info
            });
        }
    });
    self.ice.on('close', function(err) {
        self.close(err);
    });
    self.ice.on('error', function(err) {
        self.close(err);
    });
    self.ice.on('connect', function() {
        // self.conn = self.ice.get_best_candidate();
        self.emit('connect');
    });

    /*
    self.nudp.on('message', function(msg) {
        dbg.log1('N2N RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
        self.emit('message', msg);
    });
    */

    // setInterval(function() { dbg.log2('N2N STATS', self.nudp.stats()); }, 5000);
}

RpcN2NConnection.prototype._connect = function() {
    return this.ice.connect();
};

/**
 * pass remote_info to ICE and return back the ICE local info
 */
RpcN2NConnection.prototype.accept = function(remote_info) {
    return this.ice.accept(remote_info);
};

RpcN2NConnection.prototype._close = function(err) {
    this.ice.close();
};

RpcN2NConnection.prototype._send = function(msg) {
    // msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
    // return P.ninvoke(this.nudp, 'send', msg);
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

    // signaller is function(info) that sends over a signal channel
    // and delivers the info to info.target,
    // and returns back the info that was returned by the peer.
    this.signaller = options.signaller;
}

util.inherits(RpcN2NAgent, EventEmitter);

RpcN2NAgent.prototype.signal = function(params) {
    var self = this;
    dbg.log0('N2N AGENT signal:', params);

    // TODO target address is me, should use the source address but we don't send it ...

    var addr_url = url.parse(params.target, true);
    var conn = new RpcN2NConnection(addr_url, self);
    conn.on('connect', function() {
        self.emit('connection', conn);
    });
    return conn.accept(params.info);
};
