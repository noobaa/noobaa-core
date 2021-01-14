/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const tls = require('tls');
// const fs = require('fs');
// const dns = require('dns');
// const url = require('url');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const url_utils = require('../util/url_utils');
const ssl_utils = require('../util/ssl_utils');
const nb_native = require('../util/nb_native');
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
    'public_ips'
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

        // we expect all n2n connections to register on the agent n2n_reset event
        this.setMaxListeners(100);

        // send_signal is function(info) that sends over a signal channel
        // and delivers the info to info.target,
        // and returns back the info that was returned by the peer.
        let send_signal = options.send_signal;

        // lazy loading of nb_native to use Nudp
        let Nudp = nb_native().Nudp;

        // initialize the default config structure
        this.n2n_config = {

            // ip options
            offer_ipv4: true,
            offer_ipv6: true,
            accept_ipv4: true,
            accept_ipv6: true,
            offer_internal: config.N2N_OFFER_INTERNAL,

            // tcp options
            tcp_active: true,
            tcp_permanent_passive: {
                min: 60101, //60100 is used by the hosted agents
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

            public_ips: [],

            // ssl options - apply for both tcp-tls and udp-dtls
            ssl_options: {
                // we allow self generated certificates to avoid public CA signing:
                rejectUnauthorized: false,
                secureContext: tls.createSecureContext({ honorCipherOrder: true, ...ssl_utils.generate_ssl_certificate() }),
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
        dbg.log('set_rpc_address:', rpc_address, 'was', this.rpc_address);
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
            tls.createSecureContext({ ...secure_context_params, honorCipherOrder: true });
    }

    update_n2n_config(n2n_config) {
        dbg.log0('UPDATE N2N CONFIG', n2n_config);
        _.each(n2n_config, (val, key) => {
            if (key === 'tcp_permanent_passive') {
                // since the tcp permanent object holds more info than just the port_range
                // then we need to check if the port range cofig changes, if not we ignore
                // if it did then we have to start a new
                const conf = _.pick(this.n2n_config.tcp_permanent_passive, N2N_CONFIG_PORT_PICK);
                dbg.log0('update_n2n_config: update tcp_permanent_passive old', conf, 'new', val);
                if (!_.isEqual(conf, val)) {
                    this.disconnect();
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

    disconnect() {
        let conf = this.n2n_config.tcp_permanent_passive;
        if (conf.server) {
            dbg.log0('close tcp_permanent_passive old server');
            conf.server.close();
            conf.server = null;
            global_tcp_permanent_passive = null;
        }
    }

    get_plain_n2n_config() {
        const n2n_config =
            _.pick(this.n2n_config, N2N_CONFIG_FIELDS_PICK);
        n2n_config.tcp_permanent_passive =
            n2n_config.tcp_permanent_passive ?
            _.pick(n2n_config.tcp_permanent_passive, N2N_CONFIG_PORT_PICK) :
            n2n_config.tcp_permanent_passive;
        return n2n_config;
    }

    accept_signal(params) {
        dbg.log1('N2N AGENT accept_signal:', params, 'my rpc_address', this.rpc_address);

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

module.exports = RpcN2NAgent;
