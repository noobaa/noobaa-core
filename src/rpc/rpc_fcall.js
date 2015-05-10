'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

module.exports = RpcFcallConnection;

util.inherits(RpcFcallConnection, EventEmitter);

function RpcFcallConnection(addr_url) {
    var self = this;
    self.connid = addr_url.host;
    self.url = addr_url;
    EventEmitter.call(self);

    self.close = function() {};
    self.connect = function() {};

    self.send = function(msg) {
        setImmediate(function() {
            self.emit('message', msg);
        });
    };
}
