/* Copyright (C) 2016 NooBaa */
'use strict';

const net_ping = require('net-ping');
const _ = require('lodash');
const dbg = require('./debug_module')(__filename);
const url = require('url');
const dns = require('dns');
const P = require('./promise');
const os_utils = require('./os_utils');
const promise_utils = require('./promise_utils');

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
    const modified_target = url.parse(target).hostname || target;
    return os_utils.get_dns_servers()
        .then(dns_config => {
            if (dns_config.search_domains.length) {
                let resolved_successfully = false;
                let current = -1;
                return promise_utils.pwhile(
                        () => !resolved_successfully && current < dns_config.search_domains.length,
                        () => {
                            current += 1;
                            return P.fromCallback(callback => dns.resolve(modified_target + '.' + dns_config.search_domains[current],
                                    (options && options.rrtype) || 'A', callback))
                                .then(() => {
                                    dbg.log3('Resolved DNS name successfuly with', modified_target + '.' + dns_config.search_domains[current]);
                                    resolved_successfully = true;
                                })
                                .catch(_.noop);
                        })
                    .then(() => {
                        if (resolved_successfully) {
                            return P.resolve();
                        }
                        return P.fromCallback(callback => dns.resolve(modified_target,
                            (options && options.rrtype) || 'A', callback));
                    });
            }
            return P.fromCallback(callback => dns.resolve(modified_target,
                (options && options.rrtype) || 'A', callback));
        });
}

function is_hostname(target) {
    const regExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (regExp.test(target)) {
        return true;
    }

    return false;
}

function _is_valid_ip(input) {
    let ip_regex = /^(([1-9]?\d|1\d\d|2[0-5][0-5]|2[0-4]\d)\.){3}([1-9]?\d|1\d\d|2[0-5][0-5]|2[0-4]\d)$/;
    return Boolean(ip_regex.exec(input));
}

exports.ping = ping;
exports.dns_resolve = dns_resolve;
exports.is_hostname = is_hostname;
