'use strict';

const net_ping = require('net-ping');
const _ = require('lodash');
const dbg = require('./debug_module')(__filename);
const url = require('url');
const dns = require('dns');
const P = require('./promise');

const DEFAULT_PING_OPTIONS = {
    timeout: 5000,
    retries: 0,
    packetSize: 64
};

function ping(target, options) {
    dbg.log1('pinging', target);

    options = options || DEFAULT_PING_OPTIONS;
    _.defaults(options, DEFAULT_PING_OPTIONS);
    let session = net_ping.createSession(options);
    return P.resolve()
        .then(() => {
            let candidate_ip = url.parse(target).hostname || target;
            if (_is_valid_ip(candidate_ip)) {
                return _ping_ip(session, candidate_ip);
            }
            return dns_resolve(target)
                .then(ip_table =>
                    P.any(_.map(ip_table, ip => _ping_ip(session, ip))));
        });
}

function _ping_ip(session, ip) {
    return new Promise((resolve, reject) => {
        session.pingHost(ip, error => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

function dns_resolve(target, options) {
    dbg.log0('resolving dns address', target);
    return P.fromCallback(callback => dns.resolve(url.parse(target).hostname || target,
        (options && options.rrtype) || 'A', callback));
}

function _is_valid_ip(input) {
    let ip_regex = /^(([1-9]?\d|1\d\d|2[0-5][0-5]|2[0-4]\d)\.){3}([1-9]?\d|1\d\d|2[0-5][0-5]|2[0-4]\d)$/;
    return Boolean(ip_regex.exec(input));
}

exports.ping = ping;
exports.dns_resolve = dns_resolve;
