'use strict';

var Q = require('q');
var crypto = require('crypto');

module.exports = RpcRequest;

function RpcRequest(api, method_api, params, options) {
    this.time = Date.now();
    this.rand = crypto.pseudoRandomBytes(4).toString('base64');
    this.reqid = this.time + ':' + this.rand;
    this.api = api;
    this.method_api = method_api;
    this.params = params;
    this.options = options;
    this.defer = Q.defer();
    this.promise = this.defer.promise;
}

RpcRequest.prototype.get_req_json = function() {
    return {
        reqid: this.reqid,
        api_name: this.api.name,
        method_name: this.method_api.name,
        params: this.params
    };
};
