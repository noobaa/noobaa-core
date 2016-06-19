'use strict';

let _ = require('lodash');
let dbg = require('../util/debug_module')(__filename);
let RpcError = require('../rpc/rpc_error');

/*
// TODO zlib in browserify doesn't work?
// let zlib = require('zlib');
let ZLIB_OPTIONS = {
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

    // constructor() {}

    // rpc_params is a synonyms to params.
    // we keep it to make the server code that uses params more explicit
    // and clear that this request and params are from rpc.
    get rpc_params() {
        return this.params;
    }
    set rpc_params(val) {
        this.params = val;
    }

    new_request(api, method_api, params, auth_token) {
        // this.reqid will be set by the connection...
        this.time = Date.now();
        this.api = api;
        this.method_api = method_api;
        this.params = params;
        this.auth_token = auth_token;
        this.srv = api.id + '.' + method_api.name;
    }

    static encode_message(header, buffers) {
        let msg_buffers = [
            new Buffer(4),
            new Buffer(JSON.stringify(header)),
            // zlib.deflateRawSync(new Buffer(JSON.stringify(header)), ZLIB_OPTIONS),
        ];
        if (buffers) {
            msg_buffers = msg_buffers.concat(buffers);
        }
        msg_buffers[0].writeUInt32BE(msg_buffers[1].length, 0);
        return msg_buffers;
    }

    static decode_message(msg_buffer) {
        let len = msg_buffer.readUInt32BE(0);
        dbg.log3('decode_message', msg_buffer.length, len);
        let header = JSON.parse(msg_buffer.slice(4, 4 + len).toString());
        // let header = JSON.parse(zlib.inflateRawSync(msg_buffer.slice(4, 4 + len)).toString());
        let buffer = (4 + len < msg_buffer.length) ? msg_buffer.slice(4 + len) : null;
        if (msg_buffer && buffer) {
            dbg.log3('decode_message with buffer', msg_buffer.length, len, 'HEADER', header, 'Buffer', buffer.length);
        }
        return {
            header: header,
            buffer: buffer
        };
    }

    export_request_buffers() {
        let header = {
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

    import_request_message(msg, api, method_api) {
        this.time = Date.now();
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

    export_response_buffer() {
        let header = {
            op: 'res',
            reqid: this.reqid
        };
        let buffers;
        if (this.error) {
            // copy the error to a plain object because otherwise
            // the message is not encoded by
            header.error = _.pick(this.error, 'rpc_code', 'message');
        } else {
            header.reply = this.reply;
            if (this.method_api.reply_export_buffers) {
                buffers = this.method_api.reply_export_buffers(this.reply);
            }
        }
        return RpcRequest.encode_message(header, buffers);
    }

    import_response_message(msg) {
        let is_pending = this.response_defer.promise.isPending();
        if (!is_pending) {
            return is_pending;
        }
        let err = msg.header.error;
        if (err) {
            this.error = new RpcError(err.rpc_code, err.message, err.retryable);
            this.response_defer.reject(this.error);
        } else {
            this.reply = msg.header.reply;
            if (this.method_api.reply_import_buffers) {
                this.method_api.reply_import_buffers(this.reply, msg.buffer);
            }
            this.response_defer.resolve(this.reply);
        }
        return is_pending;
    }

}

module.exports = RpcRequest;
