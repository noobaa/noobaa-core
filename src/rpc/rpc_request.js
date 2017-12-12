/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const RpcError = require('./rpc_error');
const time_utils = require('../util/time_utils');
const buffer_utils = require('../util/buffer_utils');

const RPC_VERSION_MAGIC = 0xba;
const RPC_VERSION_MAJOR = 0;
const RPC_VERSION_MINOR = 0;
const RPC_VERSION_FLAGS = 0;
const RPC_VERSION_NUMBER = Buffer.from([
    RPC_VERSION_MAGIC,
    RPC_VERSION_MAJOR,
    RPC_VERSION_MINOR,
    RPC_VERSION_FLAGS,
]).readUInt32BE(0);

const RPC_BUFFERS = Symbol('RPC_BUFFERS');

/**
 *
 */
class RpcRequest {

    constructor() {
        this.ts = time_utils.millistamp();
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

    _new_request(api, method_api, params, auth_token) {
        // this.reqid will be set by the connection...
        this.api = api;
        this.method_api = method_api;
        this.params = params;
        this.auth_token = auth_token;
        this.srv = api.id + '.' + method_api.name;
    }

    static encode_message(header, buffers) {
        const meta_buffer = Buffer.allocUnsafe(8);
        const header_buffer = Buffer.from(JSON.stringify(header));
        meta_buffer.writeUInt32BE(RPC_VERSION_NUMBER, 0);
        meta_buffer.writeUInt32BE(header_buffer.length, 4);
        const msg_buffers = buffers ? [
            meta_buffer,
            header_buffer,
            ...buffers
        ] : [
            meta_buffer,
            header_buffer
        ];
        return msg_buffers;
    }

    static decode_message(msg_buffers) {
        const meta_buffer = buffer_utils.extract_join(msg_buffers, 8);
        const version = meta_buffer.readUInt32BE(0);
        if (version !== RPC_VERSION_NUMBER) {
            const magic = meta_buffer.readUInt8(0);
            const major = meta_buffer.readUInt8(1);
            const minor = meta_buffer.readUInt8(2);
            const flags = meta_buffer.readUInt8(3);
            if (magic !== RPC_VERSION_MAGIC) throw new Error('RPC VERSION MAGIC MISMATCH');
            if (major !== RPC_VERSION_MAJOR) throw new Error('RPC VERSION MAJOR MISMATCH');
            if (minor !== RPC_VERSION_MINOR) throw new Error('RPC VERSION MINOR MISMATCH');
            if (flags !== RPC_VERSION_FLAGS) throw new Error('RPC VERSION FLAGS MISMATCH');
            throw new Error('RPC VERSION MISMATCH');
        }
        const header_length = meta_buffer.readUInt32BE(4);
        const header = JSON.parse(buffer_utils.extract_join(msg_buffers, header_length));
        return {
            header,
            buffers: msg_buffers
        };
    }

    _encode_request() {
        const header = {
            op: 'req',
            reqid: this.reqid,
            api: this.api.id,
            method: this.method_api.name,
            params: this.params,
            auth_token: this.auth_token || undefined,
            buffers: (this.params && this.params[RPC_BUFFERS]) || undefined,
        };
        let buffers;
        if (header.buffers) {
            buffers = [];
            header.buffers = _.map(header.buffers, (buf, name) => {
                buffers.push(buf);
                return { name, len: buf.length };
            });
        }
        return RpcRequest.encode_message(header, buffers);
    }

    _set_request(msg, api, method_api) {
        this.reqid = msg.header.reqid;
        this.api = api;
        this.method_api = method_api;
        this.params = msg.header.params;
        this.auth_token = msg.header.auth_token;
        this.srv = (api ? api.id : '?') +
            '.' + (method_api ? method_api.name : '?');
        if (msg.header.buffers) {
            const buffers = {};
            _.forEach(msg.header.buffers, a => {
                buffers[a.name] = buffer_utils.extract_join(msg.buffers, a.len);
            });
            this.params[RPC_BUFFERS] = buffers;
        }
    }

    _encode_response() {
        const header = {
            op: 'res',
            reqid: this.reqid,
            took: time_utils.millistamp() - this.ts,
        };
        let buffers;
        if (this.error) {
            // copy the error to a plain object because otherwise
            // the message is not encoded by
            header.error = _.pick(this.error, 'message', 'rpc_code', 'rpc_data');
        } else {
            header.reply = this.reply;
            header.buffers = this.reply && this.reply[RPC_BUFFERS];
            if (header.buffers) {
                buffers = [];
                header.buffers = _.map(header.buffers, (buf, name) => {
                    buffers.push(buf);
                    return { name, len: buf.length };
                });
            }
        }
        return RpcRequest.encode_message(header, buffers);
    }

    _set_response(msg) {
        const is_pending = this._response_defer.promise.isPending();
        if (!is_pending) {
            return is_pending;
        }
        this._set_times(msg.header.took);
        const err = msg.header.error;
        if (err) {
            this.error = new RpcError(err.rpc_code, err.message, err.rpc_data);
            this._response_defer.reject(this.error);
        } else {
            this.reply = msg.header.reply;
            if (msg.header.buffers) {
                const buffers = {};
                _.forEach(msg.header.buffers, a => {
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

RpcRequest.RPC_BUFFERS = RPC_BUFFERS;

module.exports = RpcRequest;
