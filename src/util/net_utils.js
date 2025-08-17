/* Copyright (C) 2016 NooBaa */
'use strict';

const os = require('os');
const net = require('net');
const ip_module = require('ip');

const fqdn_regexp = /^(?=^.{1,253}$)(^(((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9])|((?!-)[a-zA-Z0-9-]{0,62}[a-zA-Z0-9]\.)+[a-zA-Z]{2,63})$)/;

function is_fqdn(target) {
    if (target === 'localhost') return false;
    if (target && fqdn_regexp.test(target)) {
        return true;
    }

    return false;
}

/**
 * is_cidr will check if the address is CIDR
 * @param {string} ip
 */
function is_cidr(ip) {
    const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[1-2][0-9]|3[0-2])$|^[a-fA-F0-9:]+\/([0-9]|[1-9][0-9]|1[0-1][0-9]|12[0-8])$/;
    if (!cidrRegex.test(ip)) return false;
    const address = ip.split("/")[0];
    if (!net.isIP(address)) return false;
    return true;
}

/**
 * normalize_family will normalize the family
 * @param {string|number} family
 * @returns {string}
 */
function normalize_family(family) {
    if (family === 4) return 'ipv4';
    if (family === 6) return 'ipv6';
    return family ? String(family).toLowerCase() : 'ipv4';
}

/**
 * is_loopback will check if the address is a loop back address
 * any address that starts with 127. or is ::1 is considered loopback
 * @param {string} address
 * @returns {boolean}
 */
function is_loopback(address) {
    return address.startsWith('127.') || address === '::1';
}

/**
 * is_ipv6_loopback_buffer will check if the buffer is a loopback address
 * it will check if the first 15 bytes are 0 and the last byte is 1
 * this is the representation of loopback address in IPv6
 * @param {Buffer} buf 
 * @returns {boolean}
 */
function is_ipv6_loopback_buffer(buf) {
    if (!Buffer.isBuffer(buf) || buf.length !== 16) return false;
    return buf.every((b, i) => (i < 15 ? b === 0 : b === 1));
}


/**
 * is_localhost will check if the address is localhost
 * @param {string} address
 * @returns {boolean}
 */
function is_localhost(address) {
    return is_loopback(address) || address.toLowerCase() === 'localhost';
}

/**
 * is_private will check if the address is private
 * @param {string} address
 * @returns {boolean}
 */
function is_private(address) {
    // Normalize and strip optional CIDR suffix
    const addr = String(address).split('/')[0];
    // Unwrap IPv6-mapped IPv4
    const v4 = unwrap_ipv6(addr);

    // IPv4 ranges
    if (net.isIPv4(v4)) {
        return (/^10\./).test(v4) || // 10.0.0.0/8
            (/^192\.168\./).test(v4) || // 192.168.0.0/16
            (/^172\.(1[6-9]|2[0-9]|3[0-1])\./).test(v4) || // 172.16.0.0 – 172.31.255.255
            (/^127\./).test(v4) || // loopback
            (/^169\.254\./).test(v4); // link-local
    }

    // IPv6 ranges
    if (net.isIPv6(addr)) {
        const buf = ip_to_buffer_safe(addr);
        if (!buf) return false;

        // :: (unspecified)
        const is_unspecified = buf.every(b => b === 0);
        if (is_unspecified) return true;

        // ::1 (loopback)
        if (is_ipv6_loopback_buffer(buf)) return true;

        // fc00::/7 (ULA)
        if (buf[0] >= 0xfc && buf[0] <= 0xfd) return true;

        // fe80::/10 (link-local)
        if (buf[0] === 0xfe && buf[1] >= 0x80 && buf[1] <= 0xbf) return true;

        // ::ffff:a.b.c.d (IPv4-mapped) – classify by embedded IPv4
        const is_v4_mapped = buf.readUInt32BE(0) === 0 &&
            buf.readUInt32BE(4) === 0 &&
            buf.readUInt16BE(8) === 0 &&
            buf.readUInt16BE(10) === 0xffff;
        if (is_v4_mapped) {
            const embedded_v4 = `${buf[12]}.${buf[13]}.${buf[14]}.${buf[15]}`;
            return is_private(embedded_v4);
        }
        return false;
    }
    return false;
}

/**
 * is_public will check if the address is public
 * @param {string} address
 * @returns {boolean}
 */
function is_public(address) {
    return !is_private(address);
}

function unwrap_ipv6(ip) {
    if (net.isIPv6(ip)) {
        if (ip.startsWith('::ffff:')) return ip.slice('::ffff:'.length);
    }
    return ip;
}

/**
 * the name ip_toLong consist of camel case and underscore, to indicate that toLong is the function we had in node-ip
 * ip_toLong will take ip address and convert it to long
 * This will only work for ipv4
 * @param {string} ip
 */
function ip_toLong(ip) {
    // eslint-disable-next-line no-bitwise
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * the name ip_toString consist of camel case and underscore, to indicate that toString is the function we had in node-ip
 * ip_toString will take buffer and convert it to string
 * @param {Buffer<ArrayBuffer>} buff
 * @param {number} offset
 * @param {number} length
 */
function ip_toString(buff, offset, length) {
    if (offset === undefined) {
        throw new Error('Offset is required');
    }
    offset = Math.trunc(offset);
    length = length ?? (buff.length - offset);

    if (length === 4) { // IPv4
        return Array.from(buff.subarray(offset, offset + length)).join('.');
    } else if (length === 16) { // IPv6
        const result = [];
        for (let i = 0; i < length; i += 2) {
            result.push(buff.readUInt16BE(offset + i).toString(16));
        }

        let ipv6 = result.join(':');
        ipv6 = ipv6.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
        ipv6 = ipv6.replace(/:{3,4}/, '::');
        return ipv6;
    }
}

/**
 * ipv4_to_buffer will take ipv4 address and convert it to buffer
 * @param {string} ip
 * @param {Buffer<ArrayBuffer>} buff
 * @param {number} offset
 */
function ipv4_to_buffer(ip, buff, offset) {
    ip.split('.').forEach((byte, i) => {
        // eslint-disable-next-line no-bitwise
        buff[offset + i] = parseInt(byte, 10) & 0xff;
    });
    return buff;
}

/**
 * ipv6_to_buffer will take ipv6 address and convert it to buffer
 * @param {any} ip
 * @param {Buffer<ArrayBuffer>} buff
 * @param {number} offset
 */
function ipv6_to_buffer(ip, buff, offset) {
    const sections = expend_ipv6(ip);
    let i = 0;
    sections.forEach(section => {
        const word = parseInt(section, 16);
        // eslint-disable-next-line no-bitwise
        buff[offset + i] = (word >> 8) & 0xff;
        // eslint-disable-next-line no-bitwise
        buff[offset + i + 1] = word & 0xff;
        i += 2;
    });
    return buff;
}

/**
 * expend_ipv6 will take ipv6 address and expand it to array of 8 sections
 * @param {string} ip
 */
function expend_ipv6(ip) {
    const sections = ip.split(':');

    if (sections[sections.length - 1].includes('.')) {
        const ipv4Part = sections.pop();
        const v4_buffer = ipv4_to_buffer(ipv4Part, Buffer.alloc(4), 0);
        sections.push(v4_buffer.subarray(0, 2).toString('hex'));
        sections.push(v4_buffer.subarray(2, 4).toString('hex'));
    }

    const emptyIndex = sections.indexOf('');
    if (emptyIndex !== -1) {
        const missing = 8 - sections.length;
        sections.splice(emptyIndex, 1, ...new Array(missing + 1).fill('0'));
    }

    return sections.map(section => section || '0');
}

/**
 * the name ip_toBuffer consist of camel case and underscore, to indicate that toBuffer is the function we had in node-ip
 * @param {string} ip
 * @param {Buffer<ArrayBuffer>} buff
 * @param {number} offset
 */
function ip_toBuffer(ip, buff, offset) {
    if (offset === undefined) {
        throw new Error('Offset is required');
    }

    if (net.isIPv4(ip)) {
        return ipv4_to_buffer(ip, buff || Buffer.alloc(offset + 4), offset);
    } else if (net.isIPv6(ip)) {
        return ipv6_to_buffer(ip, buff || Buffer.alloc(offset + 16), offset);
    }

    throw new Error(`Invalid IP address: ${ip}`);
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

/**
 * will allocate a buffer for the given IP address
 * buffer size is determined by the IP version
 * @param {string} ip
 * @returns {Buffer|null}
 */
function ip_to_buffer_safe(ip) {
    if (net.isIPv4(ip)) {
        return ip_toBuffer(ip, Buffer.alloc(4), 0);
    } else if (net.isIPv6(ip)) {
        return ip_toBuffer(ip, Buffer.alloc(16), 0);
    } else {
        return null; // invalid IP
    }
}

/**
 * is_equal will check if two addresses are equal
 * it will handle both IPv4 and IPv6 addresses, including IPv6-mapped IPv4
 * @param {string} address1
 * @param {string} address2
 * @returns {boolean}
 */
function is_equal(address1, address2) {
    const buffer1 = ip_to_buffer_safe(address1);
    const buffer2 = ip_to_buffer_safe(address2);

    // if either address is invalid, return false
    if (!buffer1 || !buffer2) return false;

    // checks when the ips are of different type (v4 and v6)
    if (buffer1.length !== buffer2.length) {
        if (buffer1.length === 4) return address2 === `::ffff:${address1}`;
        if (buffer2.length === 4) return address1 === `::ffff:${address2}`;
        return false;
    }

    // compare the buffers when the ips are of the same type
    return buffer1.equals(buffer2);
}


exports.is_ip = is_ip;
exports.is_fqdn = is_fqdn;
exports.is_cidr = is_cidr;
exports.is_localhost = is_localhost;
exports.unwrap_ipv6 = unwrap_ipv6;
exports.ip_toLong = ip_toLong;
exports.ip_toString = ip_toString;
exports.ip_toBuffer = ip_toBuffer;
exports.ip_to_long = ip_to_long;
exports.find_ifc_containing_address = find_ifc_containing_address;
exports.is_equal = is_equal;

/// EXPORTS FOR TESTING:
exports.normalize_family = normalize_family;
exports.is_loopback = is_loopback;
exports.is_private = is_private;
exports.is_public = is_public;
exports.ipv4_to_buffer = ipv4_to_buffer;
exports.ipv6_to_buffer = ipv6_to_buffer;
exports.expend_ipv6 = expend_ipv6;
exports.ip_to_buffer_safe = ip_to_buffer_safe;
exports.is_ipv6_loopback_buffer = is_ipv6_loopback_buffer;
