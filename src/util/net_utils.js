/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const os = require('os');
const url = require('url');
const net = require('net');
const dns = require('dns');
const ip_module = require('ip');
const pinger = require('ping');

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

    options = options || DEFAULT_PING_OPTIONS;
    _.defaults(options, DEFAULT_PING_OPTIONS);
    const candidate_ip = url.parse(target).hostname || target;

    if (net.isIP(candidate_ip)) {
        await _ping_ip(candidate_ip);
    } else {
        const ip_table = await dns_resolve(target);
        await P.map_any(ip_table, ip => _ping_ip(ip));
    }
}

function _ping_ip(session, ip) {
    return new Promise((resolve, reject) => {
        pinger.sys.probe(ip, (is_alive, error) => {
            if (is_alive) {
                resolve();
            } else {
                reject(error);
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

function is_ip(address) {
    return ip_module.isV4Format(address) || ip_module.isV6Format(address);
}

function find_ifc_containing_address(address) {
    const family =
        (ip_module.isV4Format(address) && 'IPv4') ||
        (ip_module.isV6Format(address) && 'IPv6') ||
        '';
    if (!family) return;
    for (const [ifc, arr] of Object.entries(os.networkInterfaces())) {
        for (const info of arr) {
            if (info.family === family && ip_module.cidrSubnet(info.cidr).contains(address)) {
                return { ifc, info };
            }
        }
    }
}

exports.ping = ping;
exports.dns_resolve = dns_resolve;
exports.is_hostname = is_hostname;
exports.is_ip = is_ip;
exports.is_fqdn = is_fqdn;
exports.is_localhost = is_localhost;
exports.unwrap_ipv6 = unwrap_ipv6;
exports.ip_to_long = ip_to_long;
exports.find_ifc_containing_address = find_ifc_containing_address;
