/* Copyright (C) 2016 NooBaa */
'use strict';

const ip_module = require('ip');
const url = require('url');
const { construct_url } = require('./url_utils');

const default_base_port = parseInt(process.env.SSL_PORT, 10) || 5443;
const api_default_ports = Object.freeze(get_default_ports());

function format_base_address(hostname = 'localhost', port = default_base_port) {
    return url.format(`wss://${hostname}:${port}`);
}

function get_base_address(address_list, options = {}) {
    let {
        hint = 'INTERNAL',
        service = '',
        api = 'mgmt',
        protocol = 'wss',
        secure = true,
    } = options;

    const api_list = address_list.filter(addr =>
        (!service || addr.service === service) &&
        addr.api === api
    );

    let default_port = api_default_ports[api];
    if (hint === 'EXTERNAL') {
        const external_addrs = api_list.filter(addr =>
            addr.kind === 'EXTERNAL' &&
            addr.secure === secure
        );

        if (external_addrs.length > 0) {
            const [{ hostname, port }] = external_addrs.sort((addr1, addr2) =>
                addr2.weight - addr1.weight
            );
            return construct_url({ protocol, hostname, port });
        }

        hint = 'INTERNAL';
    }

    if (hint === 'INTERNAL') {
        const internal_addrs = api_list.filter(addr =>
            addr.kind === 'INTERNAL' &&
            addr.secure === secure
        );

        if (internal_addrs.length > 0) {
            const [{ hostname, port }] = internal_addrs.sort((addr1, addr2) =>
                addr2.weight - addr1.weight
            );
            return construct_url({ protocol, hostname, port });
        }

        hint = 'SERVER_IP';
    }

    if (hint === 'SERVER_IP') {
        // ip_module.address() returns loopback if no iterface is active.
        const hostname = ip_module.address();
        const port = default_port;
        return construct_url({ protocol, hostname, port });
    }

    if (hint === 'LOOPBACK') {
        const hostname = 'localhost';
        const port = default_port;
        return construct_url({ protocol, hostname, port });
    }

    throw new Error(`get_base_address: Invalid hint - ${hint}`);
}

/**
 * @param {Number} base_port
 */
function get_default_ports(base_port = default_base_port) {
    return {
        mgmt: base_port,
        md: base_port,
        bg: base_port + 2,
        hosted_agents: base_port + 3,
    };
}

exports.format_base_address = format_base_address;
exports.get_base_address = get_base_address;
exports.get_default_ports = get_default_ports;
