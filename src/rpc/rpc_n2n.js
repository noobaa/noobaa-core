'use strict';

module.exports = RpcN2NConnection;
RpcN2NConnection.Agent = RpcN2NAgent;

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var url = require('url');
var js_utils = require('../util/js_utils');
var time_utils = require('../util/time_utils');
var native_core = require('../util/native_core');
var EventEmitter = require('events').EventEmitter;
var dbg = require('../util/debug_module')(__filename);
var IceConnection = require('./ice_connection');
var NudpFlow = require('./nudp');
// var NiceConnection = require('./nice_connection');

var CONNECTORS = {
    ice: function(params) {
        return new IceConnection(params);
    },
    // nice: NiceConnection,
    // jingle: jingle,
    // webrtc: webrtc,
};

var FLOW_CONTROL = {
    nudpjs: function(params) {
        return new NudpFlow(params);
    },
    nudp: function(params) {
        var nutil = native_core();
        return new nutil.Nudp(params);
    },
    // udt: udt,
    // utp: utp,
    // sctp: sctp,
    // quic: quic,
    // dccp: dccp,
};

var DEFAULT_N2N_CONF = {
    // connector
    conn: 'ice',
    // flow-control
    flow: 'nudp'
};


/**
 *
 * RpcN2NConnection
 *
 * n2n - node-to-node or noobaa-to-noobaa, essentially p2p, but noobaa branded.
 *
 * NOTE: this connection class is meant to be as flexible as possible
 * because at this point we do not know which of the stacks would prove best,
 * so we want to be able to experiment with as many as possible.
 * this generalization will requires extra resources (memory, cpu)
 * and once we have our pick we can discard the flexibility in favor of performance.
 *
 */
function RpcN2NConnection(addr_url, n2n_agent) {
    var self = this;
    EventEmitter.call(self);

    self.n2n_agent = n2n_agent;
    self.url = addr_url;

    // generate connection id only used for identifying in debug prints
    self.connid = 'N2N-' + time_utils.nanostamp().toString(36);

    var Nudp = native_core().Nudp;
    self.nudp = new Nudp();
    self.nudp.on('message', function(msg) {
        // console.log('******* N2N RECEIVE', msg.length);
        self.emit('message', msg);
    });

    setInterval(function() {
        console.log('N2N STATS', self.nudp.stats());
    }, 5000);

    /*
    // use the configuration from the url query (parsed before)
    var conf = self.conf = _.defaults(self.url.query, DEFAULT_N2N_CONF);
    dbg.log0('N2N', 'conn=' + conf.conn, 'flow=' + conf.flow);

    self.flow = FLOW_CONTROL[conf.flow](self.connid);
    self.connector = CONNECTORS[conf.conn]({
        addr_url: addr_url,
        signaller: function(info) {
            return self.n2n_agent.signaller({
                target: self.url.href,
                info: info
            });
        }
    });

    js_utils.self_bind(self, 'close');
    js_utils.self_bind(self.flow, 'recvmsg');
    js_utils.self_bind(self.connector, 'send');

    // handle close and error
    self.connector.on('error', self.close);
    self.connector.on('close', self.close);
    self.flow.on('error', self.close);
    self.flow.on('close', self.close);

    // redirect packets - connector <-> flow
    self.connector.on('message', self.flow.recvmsg);
    self.flow.on('sendmsg', self.connector.send);

    // once a complete message is assembled it is emitted from the connection
    self.flow.on('message', function(msg) {
        self.emit('message', msg);
    });
    */
}

util.inherits(RpcN2NConnection, EventEmitter);

RpcN2NConnection.prototype.connect = function() {
    var self = this;
    if (self.connect_promise) {
        return self.connect_promise;
    }
    self.connect_promise = self.n2n_agent.signaller({
            target: self.url.href,
            info: {}
        })
        .then(function() {
            self.nudp.connect(self.url.port, self.url.hostname);
        });
    return self.connect_promise;

    // return this.connector.connect();
};

RpcN2NConnection.prototype.accept = function(info) {
    this.nudp.bind(this.url.port, this.url.hostname);
    // return this.connector.accept(info);
};

RpcN2NConnection.prototype.close = function(err) {
    if (err) {
        dbg.error('N2N CONNECTION ERROR', err.stack || err);
    }
    if (this.closed) {
        return;
    }
    this.closed = true;
    this.nudp.close();
    /*
    this.connector.close();
    this.flow.close();
    */
    this.emit('close');
};

RpcN2NConnection.prototype.send = function(msg) {
    msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
    // console.log('******* N2N SEND', msg.length);
    return P.ninvoke(this.nudp, 'send', msg);
    // return this.flow.send(msg);
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
    dbg.log0('N2N AGENT signal:', params);

    // TODO target address is me, should use the source address ...

    var addr_url = url.parse(params.target, true);
    var conn = new RpcN2NConnection(addr_url, this);
    this.emit('connection', conn);
    return conn.accept(params.info);
};
