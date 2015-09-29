'use strict';

var _ = require('lodash');
var util = require('util');
var events = require('events');
var P = require('../util/promise');
var time_utils = require('../util/time_utils');
var dbg = require('../util/debug_module')(__filename);

module.exports = RpcBaseConnection;

util.inherits(RpcBaseConnection, events.EventEmitter);

function RpcBaseConnection(addr_url) {
    this.url = addr_url;
    this.connid = addr_url.href + '(' + time_utils.nanostamp().toString(36) + ')';
    this._rpc_req_seq = 1;
}

RpcBaseConnection.prototype.connect = function() {
    if (this.closed) {
        throw new Error('RPC CONN DISCONNECTED ' + this.connid + ' ' + this.url.href);
    }
    if (!this.connected_promise) {
        this.connected_promise = P.invoke(this, '_connect');
    }
    return this.connected_promise;
};

RpcBaseConnection.prototype.close = function(err) {
    if (err) {
        dbg.error('RPC CONN CLOSE ON ERROR', this.connid, this.url.href, err.stack || err);
    }
    if (this.closed) return;
    this.closed = true;
    this.connected_promise = P.reject('CLOSED');
    this.connected_promise.fail(_.noop); // this is to prevent the promise to be considered as unhandled rejection
    this.emit('close');
    this._close();
};

RpcBaseConnection.prototype.send = function(msg, op, req) {
    if (this.closed) {
        throw new Error('RPC CONN DISCONNECTED ' + this.connid + ' ' + this.url.href);
    }
    return this._send(msg, op, req);
};

RpcBaseConnection.prototype._alloc_reqid = function() {
    var reqid = this._rpc_req_seq + '@' + this.connid;
    this._rpc_req_seq += 1;
    return reqid;
};
