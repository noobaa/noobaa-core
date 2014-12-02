/* jshint node:true */
'use strict';

var _ = require('lodash');
var Q = require('q');
var moment = require('moment');
var db = require('./db');


module.exports = {
    get_minimum_online_heartbeat: get_minimum_online_heartbeat,
    get_minimum_alloc_heartbeat: get_minimum_alloc_heartbeat,
};


function get_minimum_online_heartbeat(node) {
    return moment().subtract(5, 'minutes').toDate();
}

function get_minimum_alloc_heartbeat(node) {
    return moment().subtract(2, 'minutes').toDate();
}
