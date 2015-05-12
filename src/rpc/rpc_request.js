'use strict';

module.exports = RpcRequest;

var _ = require('lodash');
// var crypto = require('crypto');
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
RpcRequest.prototype.new_request = function(addr, api, method_api, params, auth_token) {
    this.time = Date.now();
    // reqid will be set by the connection...
    // this.reqid = this.time.toString(16) + Math.random().toString(16).slice(1);
    this.addr = addr;
    this.api = api;
    this.method_api = method_api;
    this.params = params;
    this.auth_token = auth_token;
    this.srv = this.addr +
        '/' + api.name +
        '/' + method_api.name;
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
        addr: this.addr,
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
    this.addr = msg.header.addr;
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
    this.srv = (this.addr || '') +
        '/' + (api ? api.name : '?') +
        '/' + (method_api ? method_api.name : '?');
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
        header.error = this.error;
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
    if (msg.header.error) {
        this.error = msg.header.error;
        this.response_defer.reject(this.error);
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
 * @return error object to be thrown by the caller as in: throw res.error(...)
 */
RpcRequest.prototype.rpc_error = function(name, err_data, reason) {
    var code = RpcRequest.ERRORS[name];
    if (!code) {
        dbg.error('*** UNDEFINED RPC ERROR', name, 'RETURNING INTERNAL ERROR INSTEAD');
        code = 500;
    }
    var err = _.isError(err_data) ? err_data : new Error(err_data);
    dbg.error('RPC ERROR', this.srv, code, name, reason, err.stack);
    if (this.error) {
        dbg.error('RPC MULTIPLE ERRORS, existing error', this.error);
        return err;
    }
    this.error = {
        code: code,
        name: name,
        data: err_data,
    };
    if (this.response_defer) {
        this.response_defer.reject(err);
    }
    return err;
};

/**
 * these error codes are following the http codes as much as possible,
 * but might define other semantics if required.
 * each error name is mapped to a code number which will be sent along with the name.
 */
RpcRequest.ERRORS = {

    /**
     * internal errors is used whenever no other specific error was identified.
     * one should prefer to use a more specific error if possible.
     */
    INTERNAL: 500,

    /**
     * unavailable mean that a required service is currently not available.
     * a classic case for delay and retry.
     */
    UNAVAILABLE: 503,

    /**
     * bad request means invalid params schema.
     */
    BAD_REQUEST: 400,

    /**
     * bad reply means invalid reply schema.
     */
    BAD_REPLY: 500,

    /**
     * not found means that the requested api or method was not found.
     */
    NOT_FOUND: 404,

    /**
     * unauthorized mean that the session/request does not contain authorization info
     */
    UNAUTHORIZED: 401,

    /**
     * forbidden means that the authorization is not sufficient for the operations
     */
    FORBIDDEN: 403,

    /**
     * exists means that the request conflicts with current state.
     * like when asked to create an entity which already exists.
     */
    CONFLICT: 409,
};
