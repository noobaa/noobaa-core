'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = RpcRequest;

var get_params_property = {
    enumerable: true,
    get: function() {
        return this.params;
    }
};

/**
 *
 */
function RpcRequest() {
    this.defer = Q.defer();

    // rest_params and rpc_params are DEPRECATED.
    // keeping for backwards compatability
    Object.defineProperty(this, 'rest_params', get_params_property);
    Object.defineProperty(this, 'rpc_params', get_params_property);
}


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
    this.options = options;
    this.srv =
        '/' + api.name +
        '/' + this.domain +
        '/' + method_api.name;
};

/**
 *
 */
RpcRequest.prototype.export_request = function() {
    return {
        reqid: this.reqid,
        api: this.api.name,
        method: this.method_api.name,
        domain: this.domain,
        params: this.params
    };
};

/**
 * load request from exported info
 * NOTE: api and method_api should be resolved by the caller and set
 */
RpcRequest.prototype.import_request = function(req) {
    this.reqid = req.reqid;
    this.domain = req.domain;
    this.params = req.params;
    this.time = parseInt(req.reqid.slice(0, req.reqid.indexOf('.')), 10);
    this.srv =
        '/' + req.api +
        '/' + req.domain +
        '/' + req.method;
};

/**
 *
 */
RpcRequest.prototype.export_response = function() {
    var res = {
        reqid: this.reqid,
    };
    if (this.reply) {
        res.reply = this.reply;
    }
    if (this.error) {
        res.error = this.error;
    }
    return res;
};

/**
 *
 */
RpcRequest.prototype.import_response = function(res) {
    this.reply = res.reply;
    this.error = res.error;
    this.done = true;
    if (this.error) {
        this.defer.reject(this.error);
    } else {
        this.defer.resolve(this.reply);
    }
};

/**
 *
 */
RpcRequest.prototype.set_reply = function(reply) {
    if (!this.done) {
        this.reply = reply;
        this.done = true;
        this.defer.resolve();
    }
};

/**
 * mark this response with error.
 * @return error object to be thrown by the caller as in: throw res.error(...)
 */
RpcRequest.prototype.set_error = function(name, err_data) {
    var code = RpcRequest.ERRORS[name];
    if (!code) {
        dbg.error('*** UNDEFINED RPC ERROR', name, 'RETURNING INTERNAL ERROR INSTEAD');
        code = 500;
    }
    var err = _.isError(err_data) ? err_data : new Error(err_data);
    dbg.error('RPC ERROR', this.srv, code, name, err.stack);
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
};
