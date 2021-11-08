/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {import('./rpc_base_conn')} RpcBaseConnection */
/** @typedef {import('../util/promise').Defer} Defer */

const _ = require('lodash');
const RpcMessage = require('./rpc_message');
const RpcError = require('./rpc_error');
const time_utils = require('../util/time_utils');
const buffer_utils = require('../util/buffer_utils');
const js_utils = require('../util/js_utils');

const RPC_BUFFERS = Symbol('RPC_BUFFERS');

/**
 *
 */
class RpcRequest {

    static get RPC_BUFFERS() {
        return RPC_BUFFERS;
    }

    constructor() {
        this.ts = time_utils.millistamp();
        /** @type {RpcBaseConnection} */
        this.connection = undefined;
        /** @type {Defer} */
        this._response_defer = undefined;
        /** @type {Promise} */
        this._server_promise = undefined;
    }

    // rpc_params is a synonyms to params.
    // we keep it to make the server code that uses params more explicit
    // and clear that this request and params are from rpc.
    get rpc_params() {
        return this.params;
    }

    set rpc_params(val) {
        this.params = val;
    }

    get base_info() {
        return `srv ${
            this.srv
        } reqid ${
            this.reqid || '<no-reqid-yet>'
        } connid ${
            this.connection ? this.connection.connid : '<no-connection-yet>'
        }`;
    }

    get took_info() {
        if (!this.took_srv) return '';
        return `took [${
            this.took_srv.toFixed(1)
        }+${
            this.took_flight.toFixed(1)
        }=${
            this.took_total.toFixed(1)
        }]`;
    }

    _new_request(api, method_api, params, auth_token) {
        // this.reqid will be set by the connection...
        this.api = api;
        this.method_api = method_api;
        this.params = params;
        this.auth_token = auth_token;
        this.srv = api.$id + '.' + method_api.name;
    }

    /**
     * @returns {RpcMessage}
     */
    make_request_message() {
        // The undefined is here to handle the case where the RPC_BUFFERS are sometimes set to null.
        const rpc_buffers = this.params && this.params[RPC_BUFFERS];
        const body = {
            op: 'req',
            reqid: this.reqid,
            api: this.api.$id,
            method: this.method_api.name,
            params: this.params && js_utils.omit_symbol(this.params, RPC_BUFFERS),
            auth_token: this.auth_token || undefined,
            buffers: rpc_buffers && _.map(rpc_buffers, (buf, name) => ({
                name,
                len: buf.length
            }))
        };
        return new RpcMessage(
            body,
            rpc_buffers && Object.values(rpc_buffers)
        );
    }

    /**
     * @returns {RpcMessage}
     */
    make_response_message() {
        const body = {
            op: 'res',
            reqid: this.reqid,
            took: time_utils.millistamp() - this.ts,
        };

        if (this.error) {
            // copy the error to a plain object because otherwise
            // the message is not encoded by
            body.error = _.pick(this.error, 'message', 'rpc_code', 'rpc_data');
            return new RpcMessage(body);

        } else {
            const rpc_buffers = this.reply && this.reply[RPC_BUFFERS];
            body.reply = js_utils.omit_symbol(this.reply, RPC_BUFFERS);
            body.buffers = rpc_buffers && _.map(rpc_buffers, (buf, name) => ({
                name,
                len: buf.length
            }));

            return new RpcMessage(
                body,
                rpc_buffers && Object.values(rpc_buffers)
            );
        }
    }

    _set_request(msg, api, method_api) {
        this.reqid = msg.body.reqid;
        this.api = api;
        this.method_api = method_api;
        this.params = msg.body.params;
        this.auth_token = msg.body.auth_token;
        this.srv = `${api ? api.$id : '?'}.${method_api ? method_api.name : '?'}`;

        if (msg.body.buffers) {
            const buffers = {};
            _.forEach(msg.body.buffers, a => {
                buffers[a.name] = buffer_utils.extract_join(msg.buffers, a.len);
            });
            this.params[RPC_BUFFERS] = buffers;
        }
    }

    _set_response(msg) {
        const is_pending = this._response_defer.isPending;
        if (!is_pending) {
            return is_pending;
        }
        this._set_times(msg.body.took);
        const err = msg.body.error;
        if (err) {
            this.error = new RpcError(err.rpc_code, err.message, err.rpc_data);
            this.error.stack = ''; // don't print this stack
            this._response_defer.reject(this.error);
        } else {
            this.reply = msg.body.reply;
            if (msg.body.buffers) {
                const buffers = {};
                _.forEach(msg.body.buffers, a => {
                    buffers[a.name] = buffer_utils.extract_join(msg.buffers, a.len);
                });
                this.reply[RPC_BUFFERS] = buffers;
            }
            this._response_defer.resolve(this.reply);
        }
        return is_pending;
    }

    _set_times(took_srv) {
        this.took_srv = took_srv;
        this.took_total = time_utils.millistamp() - this.ts;
        this.took_flight = this.took_total - this.took_srv;
    }
}

module.exports = RpcRequest;
