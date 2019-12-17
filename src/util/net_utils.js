/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const net = require('net');
const dns = require('dns');
const request = require('request');
const net_ping = require('net-ping');
const ip_module = require('ip');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
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
            if (net.isIP(candidate_ip)) {
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
    return os_utils.get_dns_config()
        .then(dns_config => P.fromCallback(callback =>
            dns.resolve(modified_target, (options && options.rrtype) || 'A', callback)
        ));
}

function is_hostname(target) {
    const regExp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (regExp.test(target)) {
        return true;
    }

    return false;
}

function is_fqdn(target) {
    const regExp = /^(?=^.{1,253}$)(^(((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])|((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63})$)/;
    if (target && regExp.test(target)) {
        return true;
    }

    return false;
}

function unwrap_ipv6(ip) {
    if (net.isIPv6(ip)) {
        if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
    }
    return ip;
}

function ip_to_long(ip) {
    return ip_module.toLong(unwrap_ipv6(ip));
}

async function retrieve_public_ip() {
    const IPIFY_TIMEOUT = 30 * 1000;
    try {
        await promise_utils.timeout(async () => {
            const res = await P.fromCallback(callback =>
                request.get('http://api.ipify.org/', callback)
            );
            if (!is_ip(res.body)) {
                return undefined;
            }
            return res.body;
        }, IPIFY_TIMEOUT);
    } catch (err) {
        dbg.log0_throttled('failed to ipify', err);
        return undefined;
    }
}

function is_ip(address) {
    return ip_module.isV4Format(address) || ip_module.isV6Format(address);
}



exports.ping = ping;
exports.dns_resolve = dns_resolve;
exports.is_hostname = is_hostname;
exports.is_ip = is_ip;
exports.is_fqdn = is_fqdn;
exports.unwrap_ipv6 = unwrap_ipv6;
exports.ip_to_long = ip_to_long;
exports.retrieve_public_ip = retrieve_public_ip;
