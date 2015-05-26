'use strict';

module.exports = RpcRequest;

var _ = require('lodash');
var dbg = require('noobaa-util/debug_module')(__filename);

/**
 *
 */
function RpcRequest() {

}

// rpc_params is a synonyms to params.
// we keep it to make the server code that uses params more explicit
// and clear that this request and params are from rpc.
Object.defineProperty(RpcRequest.prototype, 'rpc_params', {
    enumerable: false,
    get: function() {
        return this.params;
    },
    set: function(val) {
        this.params = val;
    }
});

/**
 *
 */
RpcRequest.prototype.new_request = function(api, method_api, params, auth_token) {
    this.time = Date.now();
    // reqid will be set by the connection...
    // this.reqid = this.time.toString(16) + Math.random().toString(16).slice(1);
    this.api = api;
    this.method_api = method_api;
    this.params = params;
    this.auth_token = auth_token;
    this.srv = api.name + '.' + method_api.name;
    try {
        this.method_api.validate_params(this.params, 'CLIENT');
    } catch (err) {
        throw this.rpc_error('BAD_REQUEST', err);
    }
};

/**
 * @static
 */
RpcRequest.encode_message = function(header, buffers) {
    var msg_buffers = [
        new Buffer(4),
        new Buffer(JSON.stringify(header)),
    ];
    if (buffers) {
        msg_buffers = msg_buffers.concat(buffers);
    }
    dbg.log3('encode_message', msg_buffers[1].length, msg_buffers.length);
    msg_buffers[0].writeUInt32BE(msg_buffers[1].length, 0);
    return Buffer.concat(msg_buffers);
};

/**
 * @static
 */
RpcRequest.decode_message = function(msg_buffer) {
    var len = msg_buffer.readUInt32BE(0);
    dbg.log3('decode_message', msg_buffer.length, len);
    var header = JSON.parse(msg_buffer.slice(4, 4 + len).toString());
    var buffer = (4 + len < msg_buffer.length) ? msg_buffer.slice(4 + len) : null;
    return {
        header: header,
        buffer: buffer
    };
};

/**
 *
 */
RpcRequest.prototype.export_request_buffer = function() {
    var header = {
        op: 'req',
        reqid: this.reqid,
        api: this.api.name,
        method: this.method_api.name,
        params: this.params,
    };
    if (this.auth_token) {
        header.auth_token = this.auth_token;
    }
    var buffers = this.method_api.params.export_buffers(this.params);
    return RpcRequest.encode_message(header, buffers);
};

/**
 *
 */
RpcRequest.prototype.import_request_message = function(msg, api, method_api) {
    this.time = Date.now();
    this.reqid = msg.header.reqid;
    this.api = api;
    this.method_api = method_api;
    this.params = msg.header.params;
    this.auth_token = msg.header.auth_token;
    if (method_api) {
        method_api.params.import_buffers(this.params, msg.buffer);
        try {
            method_api.validate_params(this.params, 'SERVER');
        } catch (err) {
            throw this.rpc_error('BAD_REQUEST', err);
        }
    }
    this.srv = (api ? api.name : '?') +
        '.' + (method_api ? method_api.name : '?');
};

/**
 *
 */
RpcRequest.prototype.export_response_buffer = function() {
    var header = {
        op: 'res',
        reqid: this.reqid
    };
    var buffers;
    // check reply schema and set error if needed
    if (!this.error) {
        try {
            this.method_api.validate_reply(this.reply, 'SERVER');
        } catch (err) {
            this.rpc_error('BAD_REPLY', err);
        }
    }
    if (this.error) {
        // copy the error to a plain object because otherwise
        // the message is not encoded by
        header.error = _.pick(this.error, 'rpc_code', 'message');
    } else {
        header.reply = this.reply;
        buffers = this.method_api.reply.export_buffers(this.reply);
    }
    return RpcRequest.encode_message(header, buffers);
};

/**
 *
 */
RpcRequest.prototype.import_response_message = function(msg) {
    var is_pending = this.response_defer.promise.isPending;
    if (!is_pending) {
        return is_pending;
    }
    var err = msg.header.error;
    if (err) {
        this.rpc_error(err.rpc_code, err.message);
    } else {
        this.reply = msg.header.reply;
        this.method_api.reply.import_buffers(this.reply, msg.buffer);
        try {
            this.method_api.validate_reply(this.reply, 'CLIENT');
            this.response_defer.resolve(this.reply);
        } catch (err) {
            this.response_defer.reject(err);
        }
    }
    return is_pending;
};


/**
 * mark this response with error.
 * @return error object to be thrown by the caller as in: throw req.rpc_error(...)
 */
RpcRequest.prototype.rpc_error = function(rpc_code, message, reason) {
    var err = new Error('RPC ERROR');
    err.rpc_code = rpc_code || 'INTERNAL';
    err.message = message || '';
    dbg.error('RPC ERROR', this.srv, reason || '', err.rpc_code, err.message, err.stack);
    if (this.error) {
        dbg.error('RPC MULTIPLE ERRORS, existing error', this.error);
    } else {
        this.error = err;
    }
    if (this.response_defer) {
        this.response_defer.reject(err);
    }
    return err;
};
