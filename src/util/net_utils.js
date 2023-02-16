/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const net = require('net');
const dns = require('dns');
const request = require('request');
const ip_module = require('ip');

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const os_utils = require('./os_utils');
const hostname_regexp = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const fqdn_regexp = /^(?=^.{1,253}$)(^(((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])|((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63})$)/;

const DEFAULT_PING_OPTIONS = {
    timeout: 5000,
    retries: 0,
    packetSize: 64
};

async function ping(target, options) {
    dbg.log1('pinging', target);

    // the reason we require inside this function is that
    // net-ping has a native module and we don't want to require it
    // when building standalone binaries.
    // eslint-disable-next-line global-require
    const net_ping = require('net-ping');

    options = options || DEFAULT_PING_OPTIONS;
    _.defaults(options, DEFAULT_PING_OPTIONS);
    let session = net_ping.createSession(options);
    let candidate_ip = url.parse(target).hostname || target;

    if (net.isIP(candidate_ip)) {
        await _ping_ip(session, candidate_ip);
    } else {
        const ip_table = await dns_resolve(target);
        await P.map_any(ip_table, ip => _ping_ip(session, ip));
    }
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

async function dns_resolve(target, options) {
    const modified_target = url.parse(target).hostname || target;
    await os_utils.get_dns_config(); // unused? needed?
    const res = await dns.promises.resolve(modified_target, (options && options.rrtype) || 'A');
    return res;
}

function is_hostname(target) {
    if (hostname_regexp.test(target)) {
        return true;
    }

    return false;
}

function is_fqdn(target) {
    if (target && fqdn_regexp.test(target)) {
        return true;
    }

    return false;
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function is_localhost(address) {
    return (
        address === '127.0.0.1' ||
        address === '::1' ||
        address.toLowerCase() === 'localhost'
    );
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
        const res = await P.fromCallback(callback =>
            request({
                url: 'http://api.ipify.org/',
                timeout: IPIFY_TIMEOUT,
            }, callback)
        );
        if (is_ip(res.body)) {
            return res.body;
        }
    } catch (err) {
        dbg.log0_throttled('failed to ipify', err);
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
exports.is_localhost = is_localhost;
exports.unwrap_ipv6 = unwrap_ipv6;
exports.ip_to_long = ip_to_long;
exports.retrieve_public_ip = retrieve_public_ip;
