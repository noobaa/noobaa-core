'use strict';

var util = require('util');
var events = require('events');
var time_utils = require('../util/time_utils');

module.exports = RpcBaseConnection;

util.inherits(RpcBaseConnection, events.EventEmitter);

function RpcBaseConnection(addr_url) {
    this.url = addr_url;
    this.connid = addr_url.href + '(' + time_utils.nanostamp().toString(36) + ')';
}
