/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {import('./rpc_request')} RpcRequest */

const _ = require('lodash');
const events = require('events');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const time_utils = require('../util/time_utils');
const RpcError = require('./rpc_error');
const RpcMessage = require('./rpc_message');


const STATE_INIT = 'init';
const STATE_CONNECTING = 'connecting';
const STATE_CONNECTED = 'connected';
const STATE_CLOSED = 'closed';

class RpcBaseConnection extends events.EventEmitter {

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
        this.connecting_defer = new P.Defer();
        this._connect_promise = events.once(this, 'connect');
        this._connect_promise.catch(_.noop); // to prevent error log of unhandled rejection

        this._connect_timeout_ms = config.RPC_CONNECT_TIMEOUT;

        /** @type {Map<string,RpcRequest>} */
        this._sent_requests = undefined;
        /** @type {Map<string,RpcRequest>} */
        this._received_requests = undefined;

        /** @type {ReturnType<setInterval>} */
        this._ping_interval = undefined;
        /** @type {Set<string>} */
        this._ping_reqid_set = undefined;

        /** @type {ReturnType<setTimeout>} */
        this._reconnect_timeout = undefined;
        this._no_reconnect = false;
        this._reconn_backoff = 0;

        // the 'connect' event is emitted by the inherited type (http/ws/tcp/n2n)
        // and is expected after calling _connect() or when a connection is accepted
        // and already considered connected.
        this.once('connect', () => {
            if (!this.transient) {
                dbg.log1('RPC CONN CONNECTED state', this._state, this.connid);
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
            // RPC connecteion closed after an error event received from the connection
            dbg.log0('RPC CONNECTION CLOSED. got event from connection:', this.connid, err.stack || err.message || err);
            this.close(err);
        });

        this.on('message', encoded_msg => {
            try {
                var decoded_message = this._decode_message(encoded_msg);
                this.emit('decoded_message', decoded_message);
            } catch (err) {
                dbg.error(`RPC decode message failed, got: ${err.message}`);
                this.emit_error(err);
            }
        });

        // on send failures we handle by closing and rethrowing to the caller
        this.emit_error = err => this.emit('error', err);
    }

    // by default we assume non transient, but http connections use transient mode
    get transient() {
        return false;
    }

    /**
     *
     * connect
     *
     * it is not essential to call connect() since send() will do that if needed
     * but this can be useful when calling explicitly for separating timeouts
     * or reconnecting.
     */
    async connect() {
        switch (this._state) {
            case STATE_INIT:
                // start connecting and wait for the 'connect' event
                this._state = STATE_CONNECTING;
                // set a timer to limit how long we are waiting for connect
                this._connect_timeout = setTimeout(
                    () => this.emit_error(new RpcError('RPC_CONNECT_TIMEOUT', 'RPC CONNECT TIMEOUT')),
                    this._connect_timeout_ms);
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
     * @param {RpcMessage} msg
     * @param {RpcRequest} [req]
     * @returns {Promise}
     */
    async send(msg, req) {
        if (this._state !== STATE_CONNECTED) {
            throw new Error('RPC CONN NOT CONNECTED ' + this._state + ' ' + this.connid);
        }
        try {
            const encoded_message = this._encode_message(msg);
            const send_promise = this._send(encoded_message, msg.body && msg.body.op, req);
            if (!send_promise) {
                console.error('GGG NO SEND PROMISE', this);
            }
            await P.timeout(config.RPC_SEND_TIMEOUT,
                send_promise,
                () => new RpcError('RPC_SEND_TIMEOUT', 'RPC SEND TIMEOUT')
            );
        } catch (err) {
            this.emit_error(err);
        }
    }

    close(err) {
        if (this._state === STATE_CLOSED) return;
        this._state = STATE_CLOSED;
        this.emit('close');
        clearTimeout(this._connect_timeout);
        if (this.connecting_defer) {
            this.connecting_defer.reject(err || new RpcError('RPC_CONN_CLOSED', 'RPC CONN CLOSED ' + this.connid));
            this.connecting_defer = null;
        }
        this._close();
    }

    is_closed() {
        return this._state === STATE_CLOSED;
    }

    /**
     * @param {RpcMessage} msg
     * @returns {Buffer[]}
     */
    _encode_message(msg) {
        return msg.encode();
    }

    /**
     * @param {object} encoded_message
     * @returns {RpcMessage}
     */
    _decode_message(encoded_message) {
        return RpcMessage.decode(encoded_message);
    }

    _alloc_reqid() {
        let reqid = this._rpc_req_seq + '@' + this.connid;
        this._rpc_req_seq += 1;
        return reqid;
    }

    // ----------------------------------------------------------
    // The following methods are overriden by every concrete type
    // extending RpcBaseConnection
    // ----------------------------------------------------------

    /**
     * start the connection
     */
    _connect() {
        throw new Error("Not Implemented");
    }

    /**
     * send a message
     * @param {Buffer[]} msg
     * @param {string} op 
     * @param {RpcRequest} req 
     * @returns {Promise<void>}
     */
    async _send(msg, op, req) {
        throw new Error("Not Implemented");
    }

    /**
     * close the underlying connection
     */
    _close() {
        throw new Error("Not Implemented");
    }

}


module.exports = RpcBaseConnection;
