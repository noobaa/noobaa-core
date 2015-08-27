'use strict';

module.exports = RpcN2NConnection;
RpcN2NConnection.Agent = RpcN2NAgent;

var _ = require('lodash');
// var P = require('../util/promise');
var util = require('util');
var url = require('url');
var js_utils = require('../util/js_utils');
var time_utils = require('../util/time_utils');
var EventEmitter = require('events').EventEmitter;
var dbg = require('../util/debug_module')(__filename);
var IceConnection = require('./ice_connection');
var NiceConnection = require('./nice_connection');
var NudpFlow = require('./nudp');

var CONNECTORS = {
    ice: IceConnection,
    nice: NiceConnection,
    // jingle: jingle,
    // webrtc: webrtc,
};

var SECURITY = {
    no: NoSecurity,
    // dtls: DtlsSecurity,
};

var FLOW_CONTROL = {
    nudp: NudpFlow,
    // udt: udt,
    // utp: utp,
    // sctp: sctp,
    // quic: quic,
    // dccp: dccp,
};

var DEFAULT_N2N_CONF = {
    // connector
    con: 'ice',
    // security
    sec: 'no',
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

    // use the configuration from the url query (parsed before)
    var conf = self.conf = _.defaults(self.url.query, DEFAULT_N2N_CONF);
    dbg.log0('N2N', 'con=' + conf.con, 'sec=' + conf.sec, 'flow=' + conf.flow);
    self.connector = new CONNECTORS[conf.con]({
        addr_url: addr_url,
        signaller: js_utils.self_bind(self, 'signaller')
    });
    self.security = new SECURITY[conf.sec]();
    self.flow = new FLOW_CONTROL[conf.flow](self.connid);

    js_utils.self_bind(self, 'close');
    js_utils.self_bind(self.security, 'sendmsg');
    js_utils.self_bind(self.security, 'recvmsg');
    js_utils.self_bind(self.flow, 'recvmsg');
    js_utils.self_bind(self.connector, 'send');

    // handle close and error
    self.connector.on('error', self.close);
    self.connector.on('close', self.close);
    self.security.on('close', self.close);
    self.security.on('close', self.close);
    self.flow.on('error', self.close);
    self.flow.on('close', self.close);

    // packets redirection - connector <-> security <-> flow
    self.connector.on('message', self.security.recvmsg);
    self.security.on('sendmsg', self.connector.send);
    self.security.on('recvmsg', self.flow.recvmsg);
    self.flow.on('sendmsg', self.security.sendmsg);
    self.flow.on('message', function(msg) {
        // once a complete message is assembled it is emitted from the connection
        self.emit('message', msg);
    });
}

util.inherits(RpcN2NConnection, EventEmitter);

RpcN2NConnection.prototype.connect = function() {
    return this.connector.connect();
};

RpcN2NConnection.prototype.close = function(err) {
    if (err) {
        dbg.error('N2N CONNECTION ERROR', err.stack || err);
    }
    if (this.closed) {
        return;
    }
    this.closed = true;
    this.connector.close();
    this.security.close();
    this.flow.close();
    this.emit('close');
};

RpcN2NConnection.prototype.send = function(msg) {
    return this.flow.send(msg);
};

RpcN2NConnection.prototype.accept = function(info) {
    return this.connector.accept(info);
};

// forward signals
RpcN2NConnection.prototype.signaller = function(info) {
    return this.n2n_agent.signaller({
        target: this.url.href,
        info: info
    });
};



util.inherits(RpcN2NAgent, EventEmitter);

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


RpcN2NAgent.prototype.signal = function(params) {
    dbg.log0('N2N AGENT signal:', params);

    // TODO target address is me, should use the source address ...

    var addr_url = url.parse(params.target, true);
    var conn = new RpcN2NConnection(addr_url, this);
    this.emit('connection', conn);
    return conn.accept(params.info);
};


util.inherits(NoSecurity, EventEmitter);

/**
 *
 * NoSecurity
 *
 * simply propagate the packets as plaintext
 *
 */
function NoSecurity() {
    var self = this;
    EventEmitter.call(self);
    self.recvmsg = function(msg) {
        self.emit('recvmsg', msg);
    };
    self.sendmsg = function(msg) {
        self.emit('sendmsg', msg);
    };
    self.close = function() {};
}
