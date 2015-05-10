'use strict';

var util = require('util');
var EventEmitter = require('events').EventEmitter;

module.exports = RpcFcallConnection;

util.inherits(RpcFcallConnection, EventEmitter);

function RpcFcallConnection(address_url) {
    var self = this;
    self.connid = address_url.host;
    self.url = address_url;
    EventEmitter.call(self);

    self.close = function() {};
    self.connect = function() {};

    self.send = function(msg) {
        setImmediate(function() {
            self.emit('message', msg);
        });
    };
}
