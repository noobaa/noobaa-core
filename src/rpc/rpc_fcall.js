'use strict';

module.exports = RpcFcallConnection;

var _ = require('lodash');
var util = require('util');
var RpcBaseConnection = require('./rpc_base_conn');
require('setimmediate');

util.inherits(RpcFcallConnection, RpcBaseConnection);

function RpcFcallConnection(addr_url) {
    var self = this;
    RpcBaseConnection.call(self, addr_url);

    self.close = function() {};
    self.connect = function() {};

    self.send = function(msg) {
        msg = _.isArray(msg) ? Buffer.concat(msg) : msg;
        setImmediate(function() {
            self.emit('message', msg);
        });
    };
}
