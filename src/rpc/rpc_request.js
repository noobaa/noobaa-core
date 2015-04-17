'use strict';

var _ = require('_');
var Q = require('q');
var util = require('util');
var crypto = require('crypto');
var dbg = require('noobaa-util/debug_module')(__filename);

module.exports = RpcRequest;

/**
 *
 */
function RpcRequest() {
    var self;

    // rest_params and rpc_params are DEPRECATED.
    // keeping for backwards compatability
    Object.defineProperty(self, 'rest_params', {
        enumerable: true,
        get: function() {
            return self.params;
        },
    });
    Object.defineProperty(self, 'rpc_params', {
        enumerable: true,
        get: function() {
            return self.params;
        },
    });
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
    this.defer = Q.defer();
    this.promise = this.defer.promise;
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
 */
RpcRequest.prototype.import_request = function(req, api, method_api) {
    this.reqid = req.reqid;
    this.api = api;
    this.method_api = method_api;
    this.domain = req.domain;
    this.params = req.params;
    this.time = parseInt(req.reqid.slice(0, req.reqid.indexOf('.')), 10);
    this.defer = Q.defer();
    this.promise = this.defer.promise;
    this.srv =
        '/' + this.api.name +
        '/' + this.domain +
        '/' + this.method_api.name;
};

/**
 *
 */
RpcRequest.prototype.export_response = function() {
    var res = {
        reqid: this.req.reqid,
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
    this.reply = reply;
    this.done = true;
    this.defer.resolve();
};

/**
 * mark this response with error.
 * @return error object to be thrown by the caller as in: throw res.error(...)
 */
RpcRequest.prototype.set_error = function(name, err, data) {
    var code = RpcRequest.ERRORS[name];
    if (!code) {
        dbg.error('*** UNDEFINED RPC ERROR', name, 'RETURNING INTERNAL ERROR INSTEAD');
        code = 500;
    }
    if (!_.isError(err)) {
        err = new Error(err || name + ' ' + util.inspect(data));
    }
    console.error('RPC ERROR', this.srv, name, data, err.stack);
    if (!this.error) {
        this.error = {
            code: code,
            name: name,
            data: data,
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
