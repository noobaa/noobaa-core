'use strict';

var _ = require('lodash');
// var Q = require('q');
var util = require('util');
var url = require('url');
var EventEmitter = require('events').EventEmitter;
// var dbg = require('noobaa-util/debug_module')(__filename);
// var IceConnection = require('./ice');
var NiceConnection = require('./libnice');
var nudp = require('./nudp');

var CONNECTORS = {
    libnice: NiceConnection,
    // ice: IceConnection,
    // jingle: jingle,
    // webrtc: webrtc
};

var SECURITY = {
    no: function NoSecurity() {},
    // dtls: dtls,
};

var FLOW_CONTROL = {
    nudp: nudp,
    // udt: udt,
    // utp: utp,
    // sctp: sctp,
    // quic: quic,
};

var DEFAULT_N2N_CONF = {
    // connector
    con: 'libnice',
    // security
    sec: 'no',
    // flow-control
    flow: 'nudp'
};

module.exports = RpcN2NConnection;

util.inherits(RpcN2NConnection, EventEmitter);

function RpcN2NConnection(n2n_agent, addr_url) {
    var self = this;
    EventEmitter.call(self);

    self.n2n_agent = n2n_agent;
    self.url = addr_url;
    // generate connection id only used for identifying in debug prints
    var t = process.hrtime();
    self.connid = t[0].toString(36) + '_' + t[1].toString(36);

    // use the configuration from the url query (parsed before)
    var conf = self.conf = _.defaults(self.url.query, DEFAULT_N2N_CONF);
    self.connector = new CONNECTORS[conf.con]();
    self.flow = new FLOW_CONTROL[conf.flow](self.connector);
    self.security = new SECURITY[conf.sec]();

    // handle close and error
    var my_close = self.close.bind(self);
    self.flow.on('error', my_close);
    self.flow.on('close', my_close);
    self.connector.on('error', my_close);
    self.connector.on('close', my_close);

    // handle messages - redirect from connector to flow and back
    self.connector.on('message', self.flow.receive_message.bind(self.flow));
    self.flow.on('message', self.connector.send_message.bind(self.connector));

    // forward signals
    self.connector.on('signal', function(info) {
        n2n_agent.emit('signal', {
            target: {
                id: 'unused',
                peer: self.peer,
                address: self.url.href,
            },
            info: info,
        });
    });
}

RpcN2NConnection.prototype.connect = function(options) {
    return this.connector.connect({
        peer: this.url.hostname,
        security: this.security
    });
};

RpcN2NConnection.prototype.close = function(err_optional) {
    this.connector.close();
    this.flow.close();
    this.emit('close');
};

RpcN2NConnection.prototype.send = function(msg) {
    return this.flow.send(msg);
};

RpcN2NConnection.prototype.signal = function(msg) {
    return this.connector.signal(msg);
};


/**
 *
 * RpcN2NAgent
 *
 * represents an end-point of the N2N connection.
 * it will be used to accept new connections initiated by remote peers,
 * and also when initiated locally to connect to a remote peer.
 *
 */
RpcN2NConnection.Agent = RpcN2NAgent;

util.inherits(RpcN2NAgent, EventEmitter);

function RpcN2NAgent() {
    EventEmitter.call(this);
}

RpcN2NAgent.prototype.signal = function(params) {
    // TODO target address is me, should use the source address ...
    var addr_url = url.parse(params.target.address, true);
    var conn;
    if (params.info.initiator) {
        conn = new RpcN2NConnection(this, addr_url);
        conn.connect({
            initiator: true
        });
        this.emit('connection', conn);
    } else {
        // conn
    }
};
