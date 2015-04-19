'use strict';

var _ = require('lodash');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = RpcRequest;

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
RpcRequest.prototype.new_request = function(api, method_api, params, options) {
    this.time = Date.now();
    var rand = crypto.pseudoRandomBytes(4).toString('hex');
    this.reqid = this.time + '.' + rand;
    this.api = api;
    this.method_api = method_api;
    this.domain = options.domain || '*';
    this.params = params;
    this.auth_token = options.auth_token;
    this.srv =
        '/' + api.name +
        '/' + this.domain +
        '/' + method_api.name;
};

/**
 *
 */
RpcRequest.prototype.export_message = function() {
    var header = {
        op: 'req',
        reqid: this.reqid,
        api: this.api.name,
        method: this.method_api.name,
        domain: this.domain,
    };
    if (this.auth_token) {
        header.auth_token = this.auth_token;
    }
    var buffers = this.method_api.params.export_buffers(this.params);
    return {
        header: header,
        params: this.params,
        buffers: buffers
    };
};

/**
 *
 */
RpcRequest.prototype.import_message = function(msg, api, method_api) {
    this.time = Date.now();
    this.reqid = msg.header.reqid;
    this.api = api;
    this.method_api = method_api;
    this.domain = msg.header.domain;
    this.params = msg.params;
    this.method_api.params.import_buffers(this.params, msg.buffer);
    this.auth_token = msg.header.auth_token;
    this.srv =
        '/' + api.name +
        '/' + this.domain +
        '/' + method_api.name;
};

/**
 *
 */
RpcRequest.encode_message = function(msg) {
    var buffers = [
        new Buffer(8),
        new Buffer(JSON.stringify(msg.header)),
        new Buffer(JSON.stringify(msg.params))
    ].concat(msg.buffers);
    console.log('encode_message',
        buffers[1].length, buffers[2].length, buffers.length);
    buffers[0].writeUInt32BE(buffers[1].length, 0);
    buffers[0].writeUInt32BE(buffers[2].length, 1);
    return Buffer.concat(buffers);
};

/**
 *
 */
RpcRequest.decode_message = function(buffer) {
    var hlen = buffer.readUInt32BE(0);
    var plen = buffer.readUInt32BE(1);
    console.log('decode_message', buffer.length, hlen, plen);
    var header = JSON.parse(buffer.slice(8, 8 + hlen).toString());
    var params = JSON.parse(buffer.slice(8 + hlen, 8 + hlen + plen).toString());
    var data_buffer = buffer.slice(8 + hlen + plen);
    return {
        header: header,
        params: params,
        buffer: data_buffer
    };
};

/**
 *
 */
RpcRequest.prototype.set_response = function(res) {
    if (this.done) {
        return true;
    }
    this.done = true;
    if (res.error) {
        this.defer.reject(res.error);
    } else {
        this.defer.resolve(res.reply);
    }
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
    if (!this.done) {
        this.error = {
            code: code,
            name: name,
            data: err_data,
        };
        this.done = true;
        this.defer.reject(err);
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
