'use strict';

var util = require('util');
var events = require('events');
var P = require('../util/promise');
var time_utils = require('../util/time_utils');

module.exports = RpcBaseConnection;

util.inherits(RpcBaseConnection, events.EventEmitter);

function RpcBaseConnection(addr_url) {
    this.url = addr_url;
    this.connid = addr_url.href + '(' + time_utils.nanostamp().toString(36) + ')';
}

RpcBaseConnection.prototype.connect_once = function() {
    var self = this;
    if (!self.connect_promise) {
        self.connect_promise = P.invoke(self, 'connect');
    }
    return self.connect_promise;
};
