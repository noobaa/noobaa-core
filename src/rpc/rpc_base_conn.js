'use strict';

let _ = require('lodash');
let EventEmitter = require('events').EventEmitter;
let P = require('../util/promise');
let time_utils = require('../util/time_utils');
let dbg = require('../util/debug_module')(__filename);

let STATE_INIT = 'init';
let STATE_CONNECTING = 'connecting';
let STATE_CONNECTED = 'connected';
let STATE_CLOSED = 'closed';

class RpcBaseConnection extends EventEmitter {

    constructor(addr_url) {
        super();

        // the remote address of the connection
        this.url = addr_url;

        // connid is for debugging purposes
        // TODO commnicate connid to the other side to match in logs
        this.connid = addr_url.href + '(' + time_utils.nanostamp().toString(36) + ')';

        // the connection generates request sequences, see _alloc_reqid()
        this._rpc_req_seq = 1;

        // state machine
        this._state = STATE_INIT;

        // the connecting_defer is used by connect() to wait for the connected event
        this.connecting_defer = P.defer();
        this.connecting_defer.promise.fail(_.noop); // to prevent error log of unhandled rejection

        // the 'connect' event is emitted by the inherited type (http/ws/tcp/n2n)
        // and is expected after calling _connect() or when a connection is accepted
        // and already considered connected.
        this.once('connect', () => {
            if (!this.transient) {
                dbg.log0('RPC CONN CONNECTED state', this._state, this.connid);
            }
            if (this._state === STATE_CONNECTING || this._state === STATE_INIT) {
                this._state = STATE_CONNECTED;
                clearTimeout(this._connect_timeout);
            }
            if (this.connecting_defer) {
                this.connecting_defer.resolve();
                this.connecting_defer = null;
            }
        });

        // connections are closed on error, and once closed will not be reopened again.
        this.on('error', err => {
            dbg.warn('RPC CONN CLOSE ON ERROR', this.connid, err.message);
            this.close();
        });

        // on send failures we handle by closing and rethrowing to the caller
        this.emit_error = err => this.emit('error', err);
    }

    /**
     *
     * connect
     *
     * it is not essential to call connect() since send() will do that if needed
     * but this can be useful when calling explicitly for separating timeouts
     * or reconnecting.
     */
    connect() {
        switch (this._state) {
            case STATE_INIT:
                // start connecting and wait for the 'connect' event
                this._state = STATE_CONNECTING;
                // set a timer to limit how long we are waiting for connect
                this._connect_timeout = setTimeout(this.emit_error, 5000, 'RPC CONN TIMEOUT');
                this._connect();
                return this.connecting_defer.promise;
            case STATE_CONNECTING:
                return this.connecting_defer.promise;
            case STATE_CONNECTED:
                return;
            case STATE_CLOSED:
                throw new Error('RPC CONN CLOSED ' + this.connid);
            default:
                throw new Error('RPC CONN ON WEIRD STATE ' + this._state + ' ' + this.connid);
        }
    }

    /**
     *
     * send message
     *
     */
    send(msg, op, req) {
        if (this._state !== STATE_CONNECTED) {
            throw new Error('RPC CONN NOT CONNECTED ' + this._state + ' ' + this.connid);
        }
        return P.invoke(this, '_send', msg, op, req).fail(this.emit_error);
        // return this._send(msg, op, req);
    }

    close() {
        if (this._state === STATE_CLOSED) return;
        this._state = STATE_CLOSED;
        this.emit('close');
        clearTimeout(this._connect_timeout);
        if (this.connecting_defer) {
            this.connecting_defer.reject('RPC CONN CLOSED ' + this.connid);
            this.connecting_defer = null;
        }
        this._close();
    }

    is_closed() {
        return this._state === STATE_CLOSED;
    }

    _alloc_reqid() {
        let reqid = this._rpc_req_seq + '@' + this.connid;
        this._rpc_req_seq += 1;
        return reqid;
    }

}


module.exports = RpcBaseConnection;
