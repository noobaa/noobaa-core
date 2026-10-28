/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const RpcBaseConnection = require('./rpc_base_conn');
const Ice = require('./ice');
const n2n_wss = require('./n2n_wss');

/**
 *
 * RpcN2NConnection
 *
 * n2n - node-to-node or noobaa-to-noobaa, essentially p2p, but noobaa branded.
 * Transport is WSS by default, or legacy ICE when config.ROLLBACK_TO_ICE is true.
 *
 */
class RpcN2NConnection extends RpcBaseConnection {

    constructor(addr_url, n2n_agent) {
        if (!n2n_agent) throw new Error('N2N AGENT NOT REGISTERED');
        super(addr_url);
        this.n2n_agent = n2n_agent;
        // Set by n2n_wss.bind_ws when the WSS transport is open
        /** @type {*} */
        this.ws = null;

        if (config.ROLLBACK_TO_ICE) {
            this.ice = new Ice(this.connid, n2n_agent.n2n_config, this.url.href);

            this.ice.on('close', () => {
                const closed_err = new Error('N2N ICE CLOSED');
                closed_err.stack = '';
                this.emit('error', closed_err);
            });

            this.ice.on('error', err => this.emit('error', err));
        }

        this.reset_n2n_listener = () => {
            const reset_err = new Error('N2N RESET');
            reset_err.stack = '';
            this.emit('error', reset_err);
        };
        n2n_agent.on('reset_n2n', this.reset_n2n_listener);

        if (config.ROLLBACK_TO_ICE) {
            this.ice.once('connect', session => {
                this.session = session;
                if (session.tcp) {
                    dbg.log1('N2N CONNECTED TO TCP',
                        // session.tcp.localAddress + ':' + session.tcp.localPort, '=>',
                        session.tcp.remoteAddress + ':' + session.tcp.remotePort);
                    this._send = async msg => session.tcp.frame_stream.send_message(msg);
                    session.tcp.on('message', msg => this.emit('message', msg));
                    this.emit('connect');
                } else {
                    this._send = async msg => P.ninvoke(this.ice.udp, 'send', msg);
                    this.ice.udp.on('message', msg => this.emit('message', msg));
                    if (this.controlling) {
                        dbg.log1('N2N CONNECTING NUDP', session.key);
                        P.fromCallback(callback => this.ice.udp.connect(
                                session.remote.port,
                                session.remote.address,
                                callback))
                            .then(() => {
                                dbg.log1('N2N CONNECTED TO NUDP', session.key);
                                this.emit('connect');
                            })
                            .catch(err => {
                                this.emit('error', err);
                            });
                    } else {
                        dbg.log1('N2N ACCEPTING NUDP');
                        this.emit('connect');
                        // TODO need to wait for NUDP accept event...
                    }
                }
            });
        }
    }

    /**
     * Start dialer-side connect (WSS or ICE)
     */
    _connect() {
        this.controlling = true;
        if (config.ROLLBACK_TO_ICE) {
            return this.ice.connect();
        }
        n2n_wss.connect(this).catch(err => this.emit('error', err));
    }

    /**
     * Accept remote signal info and return local info for the signal reply.
     * WSS path waits for listen before advertising endpoints.
     * @param {object} remote_info
     * @returns {object|Promise<object>}
     */
    accept(remote_info) {
        if (config.ROLLBACK_TO_ICE) {
            return this.ice.accept(remote_info);
        }
        return n2n_wss.accept(this, remote_info);
    }

    /**
     * Close the active transport and unregister reset listener
     * @param {Error} [err]
     */
    _close(err) {
        dbg.log0('_close', err);
        this.n2n_agent.removeListener('reset_n2n', this.reset_n2n_listener);
        if (config.ROLLBACK_TO_ICE) {
            this.ice.close();
            return;
        }
        this.n2n_agent.unregister_pending_session_for_conn(this);
        n2n_wss.close(this);
    }

    async _send(msg) {
        // overridden once the transport is connected (WSS bind_ws or ICE connect)
        throw new Error('N2N NOT CONNECTED');
    }

}


module.exports = RpcN2NConnection;
