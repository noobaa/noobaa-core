/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var os = require('os');

module.exports = {
    get_main_external_ipv4: get_main_external_ipv4,
    get_external_ipv4: get_external_ipv4,
};


/**
 *
 * get_main_external_ipv4
 *
 * return main external IP of this OS.
 *
 * @return single string
 *
 */
function get_main_external_ipv4() {
    var ips = get_external_ipv4();
    if (!_.isArray(ips)) {
        return ips;
    }
    // if multiple external IPs we use an incredible algorithm
    // to find the main external ip, and it is ... to pick the first.
    // this is how AI is done in real life, bitches.
    return ips[0];
}


/**
 *
 * get_external_ipv4
 *
 * return external IPs of this OS.
 *
 * @return if only one external IP then return single string, otherwise array of strings.
 *
 */
function get_external_ipv4() {
    var ips;
    _.each(os.networkInterfaces(), function(ifcs, name) {
        _.each(ifcs, function(ifc) {
            if (ifc.internal || !ifc.address || ifc.family !== 'IPv4') {
                return;
            }
            if (!ips) {
                ips = ifc.address;
            } else if (_.isArray(ips)) {
                ips.push(ifc.address);
            } else {
                ips = [ips, ifc.address];
            }
        });
    });
    return ips;
}
