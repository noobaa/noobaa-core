/* Copyright (C) 2016 NooBaa */
'use strict';

// let _ = require('lodash');
let P = require('../util/promise');
// let url = require('url');
let RpcBaseConnection = require('./rpc_base_conn');
let nb_native = require('../util/nb_native');
let stun = require('./stun');
// let promise_utils = require('../util/promise_utils');
// let dbg = require('../util/debug_module')(__filename);

/**
 *
 * RpcNudpConnection
 *
 */
class RpcNudpConnection extends RpcBaseConnection {

    // constructor(addr_url) { super(addr_url); }

    _connect() {
        let Nudp = nb_native().Nudp;
        this.nudp = new Nudp();
        this._init_nudp();
        return P.ninvoke(this.nudp, 'bind', 0, '0.0.0.0')
            .then(port => P.ninvoke(this.nudp, 'connect', this.url.port, this.url.hostname))
            // send stun request just for testing
            .then(() => P.ninvoke(this.nudp, 'send_outbound', stun.new_packet(stun.METHODS.REQUEST), this.url.port, this.url.hostname))
            .then(() => this.emit('connect'))
            .catch(err => this.emit('error', err));
    }

    _close() {
        if (this.nudp) {
            this.nudp.close();
        }
    }

    async _send(msg) {
        return P.ninvoke(this.nudp, 'send', msg);
    }

    accept(port) {
        let Nudp = nb_native().Nudp;
        this.nudp = new Nudp();
        this._init_nudp();
        return P.ninvoke(this.nudp, 'bind', port, '0.0.0.0')
            // TODO emit event from native code?
            .then(out_port => P.delay(1000))
            .then(() => this.emit('connect'))
            .catch(err => this.emit('error', err));
    }

    _init_nudp() {
        let nudp = this.nudp;
        nudp.on('close', () => this.emit('error', new Error('NUDP CLOSED')));
        nudp.on('error', err => this.emit('error', err));
        nudp.on('message', msg => this.emit('message', [msg]));
        nudp.on('stun', (buffer, rinfo) => console.log('STUN:', rinfo, buffer));
    }

}

module.exports = RpcNudpConnection;
