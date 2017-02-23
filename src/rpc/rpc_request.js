/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const time_utils = require('../util/time_utils');
const RpcError = require('../rpc/rpc_error');
const buffer_utils = require('../util/buffer_utils');

/*
// TODO zlib in browserify doesn't work?
// const zlib = require('zlib');
const ZLIB_OPTIONS = {
    level: zlib.Z_BEST_SPEED,
    // setup memLevel and windowBits to reduce memory overhead to 32K
    // see https://nodejs.org/api/zlib.html#zlib_memory_usage_tuning
    memLevel: 5,
    windowBits: 12,
};
*/

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
        const length_buffer = new Buffer(4);
        const header_buffer = new Buffer(JSON.stringify(header));
        length_buffer.writeUInt32BE(header_buffer.length, 0);
        const msg_buffers = buffers ? [
            length_buffer,
            header_buffer,
            ...buffers
        ] : [
            length_buffer,
            header_buffer
        ];
        return msg_buffers;
    }

    static decode_message(msg_buffers) {
        const header_length = buffer_utils.extract_join(msg_buffers, 4).readUInt32BE(0);
        const header = JSON.parse(buffer_utils.extract_join(msg_buffers, header_length));
        const buffer = buffer_utils.join(msg_buffers);
        return {
            header: header,
            buffer: buffer
        };
    }

    _encode_request() {
        const header = {
            op: 'req',
            reqid: this.reqid,
            api: this.api.id,
            method: this.method_api.name,
            params: this.params,
        };
        if (this.auth_token) {
            header.auth_token = this.auth_token;
        }
        let buffers;
        if (this.method_api.params_export_buffers) {
            buffers = this.method_api.params_export_buffers(this.params);
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
        if (method_api && method_api.params_import_buffers) {
            method_api.params_import_buffers(this.params, msg.buffer);
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
            if (this.method_api.reply_export_buffers) {
                buffers = this.method_api.reply_export_buffers(this.reply);
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
            if (this.method_api.reply_import_buffers) {
                this.method_api.reply_import_buffers(this.reply, msg.buffer);
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
