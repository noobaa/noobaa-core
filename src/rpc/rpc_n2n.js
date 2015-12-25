'use strict';

module.exports = RpcN2NConnection;
RpcN2NConnection.Agent = RpcN2NAgent;

var _ = require('lodash');
var P = require('../util/promise');
// var fs = require('fs');
// var dns = require('dns');
var tls = require('tls');
// var url = require('url');
var util = require('util');
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
    if (!n2n_agent) throw new Error('N2N AGENT NOT REGISTERED');
    RpcBaseConnection.call(self, addr_url);
    self.n2n_agent = n2n_agent;
    self.ice = new Ice(self.connid, n2n_agent.n2n_config, self.url.href);

    self.ice.on('close', function() {
        var closed_err = new Error('N2N ICE CLOSED');
        closed_err.stack = '';
        self.emit('error', closed_err);
    });

    self.ice.on('error', function(err) {
        self.emit('error', err);
    });

    self.reset_n2n_listener = function() {
        var reset_err = new Error('N2N RESET');
        reset_err.stack = '';
        self.emit('error', reset_err);
    };
    n2n_agent.on('reset_n2n', self.reset_n2n_listener);

    self.ice.once('connect', function(session) {
        self.session = session;
        if (session.tcp) {
            dbg.log0('N2N CONNECTED TO TCP',
                // session.tcp.localAddress + ':' + session.tcp.localPort, '=>',
                session.tcp.remoteAddress + ':' + session.tcp.remotePort);
            self._send = function(msg) {
                session.tcp.frame_stream.send_message(msg);
            };
            session.tcp.on('message', function(msg) {
                // dbg.log0('N2N TCP RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
                self.emit('message', msg);
            });
            self.emit('connect');
        } else {
            self._send = function(msg) {
                return P.ninvoke(self.ice.udp, 'send', msg);
            };
            self.ice.udp.on('message', function(msg) {
                dbg.log1('N2N UDP RECEIVE', msg.length, msg.length < 200 ? msg.toString() : '');
                self.emit('message', msg);
            });
            if (self.controlling) {
                dbg.log0('N2N CONNECTING NUDP', session.key);
                P.invoke(self.ice.udp, 'connect', session.remote.port, session.remote.address)
                    .done(function() {
                        dbg.log0('N2N CONNECTED TO NUDP', session.key);
                        self.emit('connect');
                    }, function(err) {
                        self.emit('error', err);
                    });
            } else {
                dbg.log0('N2N ACCEPTING NUDP');
                self.emit('connect');
                // TODO need to wait for NUDP accept event...
            }
        }
    });
}

RpcN2NConnection.prototype._connect = function() {
    this.controlling = true;
    return this.ice.connect();
};

/**
 * pass remote_info to ICE and return back the ICE local info
 */
RpcN2NConnection.prototype.accept = function(remote_info) {
    return this.ice.accept(remote_info);
};

RpcN2NConnection.prototype._close = function(err) {
    this.n2n_agent.removeListener('reset_n2n', this.reset_n2n_listener);
    this.ice.close();
};

RpcN2NConnection.prototype._send = function(msg) {
    // this default error impl will be overridden once ice emit's connect
    throw new Error('N2N NOT CONNECTED');
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

    // initialize the default config structure
    self.n2n_config = {

        // ip options
        offer_ipv4: true,
        offer_ipv6: false,
        accept_ipv4: true,
        accept_ipv6: true,
        offer_internal: false,

        // tcp options
        tcp_active: true,
        tcp_permanent_passive: {
            min: 60111,
            max: 60888
        },
        tcp_transient_passive: false,
        tcp_simultaneous_open: false,
        tcp_tls: true,

        // udp options
        udp_port: true,
        udp_dtls: false,

        // TODO stun server to use for N2N ICE
        // TODO Nudp require ip's, not hostnames, and also does not support IPv6 yet
        stun_servers: [
            // read_on_premise_stun_server()
            // 'stun://64.233.184.127:19302' // === 'stun://stun.l.google.com:19302'
        ],

        // ssl options - apply for both tcp-tls and udp-dtls
        ssl_options: {
            // we allow self generated certificates to avoid public CA signing:
            rejectUnauthorized: false,
            secureContext: tls.createSecureContext({
                key: get_global_ssl_key(),
                cert: get_global_ssl_cert(),
                // TODO use a system ca certificate
                // ca: [tls_cert],
            }),
        },

        // callback to create and bind nudp socket
        // TODO implement nudp dtls
        udp_socket: function(udp_port, dtls) {
            var nudp = new Nudp();
            return P.ninvoke(nudp, 'bind', 0, '0.0.0.0').then(function(port) {
                nudp.port = port;
                return nudp;
            });
        },

        // signaller callback
        signaller: function(target, info) {
            // send ice info to the peer over a relayed signal channel
            // in order to coordinate NAT traversal.
            return self.signaller({
                source: self.rpc_address,
                target: target,
                info: info
            });
        }
    };
}

util.inherits(RpcN2NAgent, EventEmitter);

RpcN2NAgent.prototype.reset_rpc_address = function() {
    this.rpc_address = undefined;
};
RpcN2NAgent.prototype.set_rpc_address = function(rpc_address) {
    this.rpc_address = rpc_address;
};
RpcN2NAgent.prototype.set_any_rpc_address = function() {
    this.rpc_address = '*';
};

RpcN2NAgent.prototype.set_ssl_context = function(secure_context_params) {
    this.n2n_config.ssl_options.secureContext =
        tls.createSecureContext(secure_context_params);
};

var global_tcp_permanent_passive;

RpcN2NAgent.prototype.update_n2n_config = function(config) {
    dbg.log0('UPDATE N2N CONFIG', config);
    var self = this;
    _.each(config, function(val, key) {
        if (key === 'tcp_permanent_passive') {
            // since the tcp permanent object holds more info than just the port_range
            // then we need to check if the port range cofig changes, if not we ignore
            // if it did then we have to start a new
            var conf = self.n2n_config.tcp_permanent_passive;
            var conf_val = _.pick(conf, 'min', 'max', 'port');
            dbg.log0('update_n2n_config: update tcp_permanent_passive old', conf_val, 'new', val);
            if (!_.isEqual(conf_val, val)) {
                if (conf.server) {
                    dbg.log0('update_n2n_config: close tcp_permanent_passive old server');
                    conf.server.close();
                    conf.server = null;
                    global_tcp_permanent_passive = null;
                }
                if (!global_tcp_permanent_passive) {
                    global_tcp_permanent_passive = _.clone(val);
                }
                self.n2n_config.tcp_permanent_passive = global_tcp_permanent_passive;
            }
        } else {
            self.n2n_config[key] = val;
        }
    });

    // emit 'reset_n2n' to notify all existing connections to close
    self.emit('reset_n2n');
    var remaining_listeners = self.listenerCount('reset_n2n');
    if (remaining_listeners) {
        dbg.warn('update_n2n_config: remaining listeners on reset_n2n event',
            remaining_listeners, '(probably a connection that forgot to call close)');
    }
};

RpcN2NAgent.prototype.signal = function(params) {
    var self = this;
    dbg.log0('N2N AGENT signal:', params, 'my rpc_address', self.rpc_address);

    // target address is me, source is you.
    // the special case if rpc_address='*' allows testing code to accept for any target
    var source = url_utils.quick_parse(params.source);
    var target = url_utils.quick_parse(params.target);
    if (!self.rpc_address || !target ||
        (self.rpc_address !== '*' && self.rpc_address !== target.href)) {
        throw new Error('N2N MISMATCHING PEER ID ' + params.target +
            ' my rpc_address ' + self.rpc_address);
    }
    var conn = new RpcN2NConnection(source, self);
    conn.once('connect', function() {
        self.emit('connection', conn);
    });
    return conn.accept(params.info);
};


/*
function read_on_premise_stun_server() {
    return fs.readFileAsync('agent_conf.json')
        .then(function(data) {
            var agent_conf = JSON.parse(data);
            var host_url = url.parse(agent_conf.address);
            return P.nfcall(dns.resolve, host_url.hostname);
        })
        .then(function(server_ips) {
            if (!server_ips || !server_ips[0]) return;
            var stun_url = url.parse('stun://' + server_ips[0] + ':3479');
            dbg.log0('N2N STUN SERVER from agent_conf.json', stun_url.href);
            return stun_url;
        })
        .catch(function(err) {
            dbg.log0('N2N NO STUN SERVER in agent_conf.json');
        });
}
*/

// TODO this is a temporary place to keep the SSL certificate
function get_global_ssl_key() {
    return [
        '-----BEGIN RSA PRIVATE KEY-----',
        'MIIEpAIBAAKCAQEAvSegTfXkLDbLalfxrsjlFJXpaDWPDgb3ohS78+ByJXcgwPrG',
        'Q2yNO47qY04UuWkgGEUW+RXis7iPCdpYwl4RfYjAPQHIUhhlw7v7U+Sv7PIv5uUv',
        'kk/kzjz54m42K+z/NBvO/kpf/L777a9czOuUR5fCPbPg+br7PFyBh0djMw+RA/hk',
        'KSEM87jru2k4e1y1cnMv4qupVCVNaegOszSkclrFvnCUxVhyHCofhidrx7nqQhZU',
        '8zOVdrPmnakGcmX1Hux5v90eg5nm640c0xQcTOQ3rCCq3YkwYcwujtfQI+0p086d',
        'eMMCF6jJ+i2Fb2NAHYQO65jhZNWoCHlJPzsvUQIDAQABAoIBAQCYT+RBYpLNF4JM',
        'q2wtNg9guCYuh5Id1XZpyRBfnIfNq1NwkX48pJhFMRuDw0fk1MXHRTrub7UQyrhD',
        'UtLOEDk9QHSrq1fG42ZualxCfY872PjBkCLySesQNwFwVxa/4CLPruTK1tDcEF2E',
        'UwUC7V+FFqqOTN4HuYy8WjDi4ZT7c1RPD0N2xnpkk4ZmqSOhgfwWW0P29CmUorWJ',
        'PCeW0zH30YF+0xjBUH0qORc/vbSZjGjpuGAZ6KOENYcSneRI+HAENn7Z/SmxW7EW',
        'A9BQjitNRV88A+DTdGk7SC0AXxV6HN0GHlkE28N23CS+EUVtmqh8vwzpycoXkPWm',
        'gb7aBxPBAoGBAPkfQuv+Rkvr6AD3LAJeES8/4kg25zQla8ck0iyieSjDuDE22MBd',
        've2m/bAxCURTxiVuhUyI+7EbnYtjBydermyHGhNVih6JW4p7bgLdAT+j5XoXYtcs',
        '3v8jlou4lnsGfs4wpP+bdEB9ipItb1bm4Isf0c1CuBSOCDVXv1OHGF4dAoGBAMJg',
        'h4IIxXFIouUq48Qj+0yklqMpzBm1BRziwYxcoNFgQ5IaP1Q83pNO5cHuqKjr7HX/',
        'AaB0k5vgfIDzPU36SzvYnqxEqRkYAMKcxClxqqR80+m4CseunxIF6TiJtIHMDsvb',
        'YTHOYcpNQoF8fyPO46jnsbSCXfVAYrMOh4WLZl/FAoGAeolx9XrBQR7so2zw7Mkw',
        'UrltqG+5EeFGPlJSPzo7tl1vAGYl/5kcjwUQy9WS5VT/pfHTB25pvxgCSkmPf0IH',
        'McLShKgSpCqUKG3GEwp6Tr9jZMaUC5s6pOzwZBGLk0ACp5Et17yzVfVqb7SBi5FM',
        '6aHhJMGoohOq3fInXgKZbdECgYBfv6Mgp+dyrUAouR7ncH4KvAzEJQO4KhZxqzWC',
        'SeKiINRINQu7GBzf3X6KMGD+jPC3Ez2e564Km+NYtfkd30yOF1/aJhxSEyPUudpb',
        'O/W9/wt4VsNgp6EOBMFkq1iyk206eD+BhFNhjvtSw5vxbKlye2drLsjP1b6Iy4Bw',
        'hUGRrQKBgQCaVjWxbtd8Rv9tCNYDfgSAfYlfMkMziaLPiGMz/OD2LX8YV3rknAuJ',
        'OEQN98dOkLWaJogYzMPJc6RBSaZaBrvRIPgkG3JcHzib42gVyBOSjsXwThe/09OU',
        '8gj5btThBrTqiXQgm8VqSCwLgJEUwCmxUEEuXyFhgimOIimBUWg7AQ==',
        '-----END RSA PRIVATE KEY-----',
    ].join('\n');
}

// TODO this is a temporary place to keep the SSL certificate
function get_global_ssl_cert() {
    return [
        '-----BEGIN CERTIFICATE-----',
        'MIIDLjCCAhYCCQDbjDECU6toDDANBgkqhkiG9w0BAQUFADBZMQswCQYDVQQGEwJB',
        'VTETMBEGA1UECBMKU29tZS1TdGF0ZTEhMB8GA1UEChMYSW50ZXJuZXQgV2lkZ2l0',
        'cyBQdHkgTHRkMRIwEAYDVQQDEwlsb2NhbGhvc3QwHhcNMTUxMDA1MDI0OTExWhcN',
        'MTUxMTA0MDI0OTExWjBZMQswCQYDVQQGEwJBVTETMBEGA1UECBMKU29tZS1TdGF0',
        'ZTEhMB8GA1UEChMYSW50ZXJuZXQgV2lkZ2l0cyBQdHkgTHRkMRIwEAYDVQQDEwls',
        'b2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC9J6BN9eQs',
        'NstqV/GuyOUUleloNY8OBveiFLvz4HIldyDA+sZDbI07jupjThS5aSAYRRb5FeKz',
        'uI8J2ljCXhF9iMA9AchSGGXDu/tT5K/s8i/m5S+ST+TOPPnibjYr7P80G87+Sl/8',
        'vvvtr1zM65RHl8I9s+D5uvs8XIGHR2MzD5ED+GQpIQzzuOu7aTh7XLVycy/iq6lU',
        'JU1p6A6zNKRyWsW+cJTFWHIcKh+GJ2vHuepCFlTzM5V2s+adqQZyZfUe7Hm/3R6D',
        'mebrjRzTFBxM5DesIKrdiTBhzC6O19Aj7SnTzp14wwIXqMn6LYVvY0AdhA7rmOFk',
        '1agIeUk/Oy9RAgMBAAEwDQYJKoZIhvcNAQEFBQADggEBAFZ0CKD10m+Yb2y/n4j4',
        'EoLGr+pOaBPDIEgpcV5/Kf+BJpA6scs9UYaysPSCKUsLSk8SxKLOE8DxwiuYwxtu',
        'M2W69nZU1n1t84BkrJ5JyphKe8lXtjiNJIlST2BNHyMOSx/5/dyZgC+P0MHUlCmy',
        'aVeyz+7ckKB/ubr7bknNfuHkNPkZm2cUCnULZzRyCWcWl/RWA9p4CcAIxg3DZl76',
        'mAB9B6VSVAnE7fOPIrfp/5ot7D+wnbv/R1s04cc78R3DUkhPKDJKHIvVMv12BEhq',
        'On3Ht3GyCamJKqr174h4ynIk4neFaDeZ0N/jsMrkEYEpYYwiT/swuX9ZPAJ4CIKx',
        '2RE=',
        '-----END CERTIFICATE-----',
    ].join('\n');
}
