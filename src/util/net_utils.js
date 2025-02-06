/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const net = require('net');
const ip_module = require('ip');

const fqdn_regexp = /^(?=^.{1,253}$)(^(((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])|((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63})$)/;

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

//the name ip_toLong consist of camel case and underscore, to indicate that toLong is the function we had in node-ip
function ip_toLong(ip) {
    // eslint-disable-next-line no-bitwise
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function ip_to_long(ip) {
    return ip_toLong(unwrap_ipv6(ip));
}

function is_ip(address) {
    return net.isIPv4(address) || net.isIPv6(address);
}

function find_ifc_containing_address(address) {
    const family =
        (net.isIPv4(address) && 'IPv4') ||
        (net.isIPv6(address) && 'IPv6') ||
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

exports.is_ip = is_ip;
exports.is_fqdn = is_fqdn;
exports.is_localhost = is_localhost;
exports.unwrap_ipv6 = unwrap_ipv6;
exports.ip_toLong = ip_toLong;
exports.ip_to_long = ip_to_long;
exports.find_ifc_containing_address = find_ifc_containing_address;
