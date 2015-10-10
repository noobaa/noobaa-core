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
// var url_utils = require('../util/url_utils');
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

    self.ice = new Ice(self.connid, n2n_agent.ice_config, self.url.href);

    self.ice.on('close', function() {
        var closed_err = new Error('N2N ICE CLOSED');
        closed_err.stack = '';
        self.emit('error', closed_err);
    });

    self.ice.on('error', function(err) {
        self.emit('error', err);
    });

    self.ice.once('connect', function(cand) {
        if (cand.tcp) {
            dbg.log0('N2N CONNECTED TO TCP', cand.tcp.address());
            self._send = function(msg) {
                cand.tcp.frame_stream.send_message(msg);
            };
            cand.tcp.on('message', function(msg) {
                dbg.log0('N2N TCP RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
                self.emit('message', msg);
            });
            self.emit('connect');
        } else {
            self._send = function(msg) {
                return P.ninvoke(cand.udp, 'send', msg);
            };
            cand.udp.on('message', function(msg) {
                dbg.log1('N2N UDP RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
                self.emit('message', msg);
            });
            if (self.leader) {
                dbg.log0('CONNECTING NUDP');
                P.invoke(cand.udp, 'connect', cand.port, cand.address)
                    .done(function() {
                        dbg.log0('N2N CONNECTED TO UDP', cand.address + ':' + cand.port);
                        self.emit('connect');
                    }, function(err) {
                        self.emit('error', err);
                    });
            } else {
                dbg.log0('ACCEPTING NUDP');
                self.emit('connect');
            }
        }
    });
}

RpcN2NConnection.prototype._connect = function() {
    this.leader = true;
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
    // this default error impl will be overridden once ice emit's connect
    throw new Error('N2N NOT CONNECTED');
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
    var self = this;
    EventEmitter.call(self);
    options = options || {};

    // signaller is function(info) that sends over a signal channel
    // and delivers the info to info.target,
    // and returns back the info that was returned by the peer.
    self.signaller = options.signaller;

    // lazy loading of native_core to use Nudp
    var Nudp = native_core().Nudp;

    // initialize the ICE config structure
    self.ice_config = {

        // auth options
        ufrag_length: 32,
        pwd_length: 32,

        // ip options
        offer_ipv4: true,
        offer_ipv6: false,
        accept_ipv4: true,
        accept_ipv6: true,
        offer_internal: true,

        // tcp options
        tcp_active: true,
        tcp_random_passive: true,
        tcp_fixed_passive: true,
        tcp_so: false,
        tcp_secure: true,

        // udp options
        udp_socket: false && function() {
            var nudp = new Nudp();
            return P.ninvoke(nudp, 'bind', 0, '0.0.0.0').then(function(port) {
                nudp.port = port;
                return nudp;
            });
        },

        // TODO stun server to use for N2N ICE
        stun_servers: [],

        // signaller callback
        signaller: function(target, info) {
            // send ice info to the peer over a relayed signal channel
            // in order to coordinate NAT traversal.
            return self.signaller({
                target: target,
                info: info
            });
        }
    };
}

util.inherits(RpcN2NAgent, EventEmitter);

RpcN2NAgent.prototype.signal = function(params) {
    var self = this;
    dbg.log0('N2N AGENT signal:', params);

    // TODO target address is me, should use the source address but we don't send it ...

    var addr_url = url.parse(params.target, true);
    var conn = new RpcN2NConnection(addr_url, self);
    conn.once('connect', function() {
        self.emit('connection', conn);
    });
    return conn.accept(params.info);
};
