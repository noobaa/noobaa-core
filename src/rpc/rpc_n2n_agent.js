'use strict';

const _ = require('lodash');
const tls = require('tls');
// const fs = require('fs');
// const dns = require('dns');
// const url = require('url');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const url_utils = require('../util/url_utils');
const native_core = require('../util/native_core');
const EventEmitter = require('events').EventEmitter;
const RpcN2NConnection = require('./rpc_n2n');

const N2N_CONFIG_PORT_PICK = ['min', 'max', 'port'];
const N2N_CONFIG_FIELDS_PICK = [
    'offer_ipv4',
    'offer_ipv6',
    'accept_ipv4',
    'accept_ipv6',
    'offer_internal',
    'tcp_active',
    'tcp_permanent_passive',
    'tcp_transient_passive',
    'tcp_simultaneous_open',
    'tcp_tls',
    'udp_port',
    'udp_dtls',
    'stun_servers',
];

let global_tcp_permanent_passive;

/**
 *
 * RpcN2NAgent
 *
 * represents an end-point for N2N connections.
 * it will be used to accept new connections initiated by remote peers,
 * and also when initiated locally to connect to a remote peer.
 *
 */

class RpcN2NAgent extends EventEmitter {

    constructor(options) {
        super();
        options = options || {};

        // send_signal is function(info) that sends over a signal channel
        // and delivers the info to info.target,
        // and returns back the info that was returned by the peer.
        let send_signal = options.send_signal;

        // lazy loading of native_core to use Nudp
        let Nudp = native_core().Nudp;

        // initialize the default config structure
        this.n2n_config = {

            // ip options
            offer_ipv4: true,
            offer_ipv6: false,
            accept_ipv4: true,
            accept_ipv6: true,
            offer_internal: false,

            // tcp options
            tcp_active: true,
            tcp_permanent_passive: {
                min: 60100,
                max: 60600
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
            udp_socket: (udp_port, dtls) => {
                let nudp = new Nudp();
                return P.ninvoke(nudp, 'bind', 0, '0.0.0.0').then(port => {
                    nudp.port = port;
                    return nudp;
                });
            },

            // signaller callback
            // send ice info to the peer over a relayed signal channel
            // in order to coordinate NAT traversal.
            signaller: (target, info) => send_signal({
                source: this.rpc_address,
                target: target,
                info: info
            })
        };
    }

    set_rpc_address(rpc_address) {
        console.log('set_rpc_address:', rpc_address, 'was', this.rpc_address);
        this.rpc_address = rpc_address;
    }

    reset_rpc_address() {
        this.set_rpc_address('');
    }

    set_any_rpc_address() {
        this.set_rpc_address('*');
    }

    set_ssl_context(secure_context_params) {
        this.n2n_config.ssl_options.secureContext =
            tls.createSecureContext(secure_context_params);
    }


    update_n2n_config(config) {
        dbg.log0('UPDATE N2N CONFIG', config);
        _.each(config, (val, key) => {
            if (key === 'tcp_permanent_passive') {
                // since the tcp permanent object holds more info than just the port_range
                // then we need to check if the port range cofig changes, if not we ignore
                // if it did then we have to start a new
                let conf = this.n2n_config.tcp_permanent_passive;
                let conf_val = _.pick(conf, N2N_CONFIG_PORT_PICK);
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
                    this.n2n_config.tcp_permanent_passive = global_tcp_permanent_passive;
                }
            } else {
                this.n2n_config[key] = val;
            }
        });

        // emit 'reset_n2n' to notify all existing connections to close
        this.emit('reset_n2n');
        let remaining_listeners = this.listenerCount('reset_n2n');
        if (remaining_listeners) {
            dbg.warn('update_n2n_config: remaining listeners on reset_n2n event',
                remaining_listeners, '(probably a connection that forgot to call close)');
        }
    }

    get_plain_n2n_config() {
        const n2n_config =
            _.pick(this.n2n_config, N2N_CONFIG_FIELDS_PICK);
        n2n_config.tcp_permanent_passive =
            _.pick(n2n_config.tcp_permanent_passive, N2N_CONFIG_PORT_PICK);
        return n2n_config;
    }

    accept_signal(params) {
        dbg.log0('N2N AGENT accept_signal:', params, 'my rpc_address', this.rpc_address);

        // target address is me, source is you.
        // the special case if rpc_address='*' allows testing code to accept for any target
        let source = url_utils.quick_parse(params.source);
        let target = url_utils.quick_parse(params.target);
        if (!this.rpc_address || !target ||
            (this.rpc_address !== '*' && this.rpc_address !== target.href)) {
            throw new Error('N2N MISMATCHING PEER ID ' + params.target +
                ' my rpc_address ' + this.rpc_address);
        }
        let conn = new RpcN2NConnection(source, this);
        conn.once('connect', () => this.emit('connection', conn));
        return conn.accept(params.info);
    }


}


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


module.exports = RpcN2NAgent;
