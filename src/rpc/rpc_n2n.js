/* Copyright (C) 2016 NooBaa */
'use strict';

// let _ = require('lodash');
let P = require('../util/promise');
let dbg = require('../util/debug_module')(__filename);
let RpcBaseConnection = require('./rpc_base_conn');
let Ice = require('./ice');

/**
 *
 * RpcN2NConnection
 *
 * n2n - node-to-node or noobaa-to-noobaa, essentially p2p, but noobaa branded.
 *
 */
class RpcN2NConnection extends RpcBaseConnection {

    constructor(addr_url, n2n_agent) {
        if (!n2n_agent) throw new Error('N2N AGENT NOT REGISTERED');
        super(addr_url);
        this.n2n_agent = n2n_agent;
        this.ice = new Ice(this.connid, n2n_agent.n2n_config, this.url.href);

        this.ice.on('close', () => {
            let closed_err = new Error('N2N ICE CLOSED');
            closed_err.stack = '';
            this.emit('error', closed_err);
        });

        this.ice.on('error', err => this.emit('error', err));

        this.reset_n2n_listener = () => {
            let reset_err = new Error('N2N RESET');
            reset_err.stack = '';
            this.emit('error', reset_err);
        };
        n2n_agent.on('reset_n2n', this.reset_n2n_listener);

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

    _connect() {
        this.controlling = true;
        return this.ice.connect();
    }

    /**
     * pass remote_info to ICE and return back the ICE local info
     */
    accept(remote_info) {
        return this.ice.accept(remote_info);
    }

    _close(err) {
        dbg.log0('_close', err);
        this.n2n_agent.removeListener('reset_n2n', this.reset_n2n_listener);
        this.ice.close();
    }

    async _send(msg) {
        // this default error impl will be overridden once ice emit's connect
        throw new Error('N2N NOT CONNECTED');
    }

}


module.exports = RpcN2NConnection;
