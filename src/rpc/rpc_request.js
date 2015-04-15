'use strict';

var Q = require('q');
var crypto = require('crypto');

module.exports = RpcRequest;

function RpcRequest(api, method_api, params, options) {
    this.reqid = Date.now();
    this.rand = crypto.pseudoRandomBytes(4).readUInt32BE(0);
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
        rand: this.rand,
        api_name: this.api.name,
        method_name: this.method_api.name,
        params: this.params
    };
};
