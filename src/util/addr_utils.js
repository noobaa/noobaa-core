/* Copyright (C) 2016 NooBaa */
'use strict';

const ip_module = require('ip');
const url = require('url');
const { construct_url } = require('./url_utils');

const default_base_port = parseInt(process.env.SSL_PORT, 10) || 5443;
const api_default_port_offset = {
     mgmt: 0,
     md: 1,
     bg: 2,
     'hosted_agents': 3
};

function format_base_address(hostname = '127.0.0.1', port = default_base_port) {
    return url.format(`wss://${hostname}:${port}`);
}

function get_base_address(address_list, hint = 'INTERNAL', api = 'mgmt') {
    const protocol = 'wss';
    const api_list = address_list.filter(addr => addr.api === api);
    let default_port = default_base_port + api_default_port_offset[api];

    if (hint === 'EXTERNAL') {
        const extenral_addr = api_list
            .find(addr => addr.kind === 'EXTERNAL' && addr.secure);

        if (extenral_addr) {
            const { hostname, port } = extenral_addr;
            return construct_url({ protocol, hostname, port });
        }

        hint = 'INTERNAL';
    }

    if (hint === 'INTERNAL') {
        const internal_addr = api_list
            .find(addr => addr.kind === 'INTERNAL' && addr.secure);

        if (internal_addr) {
            const { hostname, port } = internal_addr;
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
        const hostname = '127.0.0.1';
        const port = default_port;
        return construct_url({ protocol, hostname, port });
    }

    throw new Error(`get_base_address: Invalid hint - ${hint}`);
}

function get_default_ports(base_port = default_base_port) {
    return Object.entries(api_default_port_offset)
        .reduce((res, [key, offset]) => {
            res[key] = base_port + api_default_port_offset[key];
            return res;
        }, {});
}

exports.format_base_address = format_base_address;
exports.get_base_address = get_base_address;
exports.get_default_ports = get_default_ports;


