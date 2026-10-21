/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const { RPC, RpcSchema } = require('../rpc');
const { get_base_address, get_default_ports, format_base_address } = require('../util/addr_utils');

// registring all api's on the same RpcSchema object
// so they share the schema namespace
const api_schema = new RpcSchema();
api_schema.register_api(require('./common_api'));
api_schema.register_api(require('./auth_api'));
api_schema.register_api(require('./account_api'));
api_schema.register_api(require('./system_api'));
api_schema.register_api(require('./tier_api'));
api_schema.register_api(require('./node_api'));
api_schema.register_api(require('./host_api'));
api_schema.register_api(require('./bucket_api'));
api_schema.register_api(require('./events_api'));
api_schema.register_api(require('./object_api'));
api_schema.register_api(require('./agent_api'));
api_schema.register_api(require('./block_store_api'));
api_schema.register_api(require('./stats_api'));
api_schema.register_api(require('./scrubber_api'));
api_schema.register_api(require('./debug_api'));
api_schema.register_api(require('./redirector_api'));
api_schema.register_api(require('./tiering_policy_api'));
api_schema.register_api(require('./pool_api'));
api_schema.register_api(require('./cluster_server_api'));
api_schema.register_api(require('./cluster_internal_api'));
api_schema.register_api(require('./server_inter_process_api'));
api_schema.register_api(require('./hosted_agents_api'));
api_schema.register_api(require('./replication_api'));
api_schema.register_api(require('./archive_api'));

api_schema.compile();

function get_schema(name) {
    return api_schema._ajv.getSchema(name);
}

function get_protocol_port(protocol) {
    switch (protocol.toLowerCase()) {
        case 'http:':
        case 'ws:': {
            return 80;
        }
        case 'https:':
        case 'wss:': {
            return 443;
        }
        default:
            return undefined;
    }
}

function new_router_from_base_address(base_address) {
    const {
        protocol,
        hostname,
        port,
        slashes,
    } = url.parse(base_address);

    const ports = get_default_ports(Number(port) || get_protocol_port(protocol));

    return {
        default: url.format({ protocol, slashes, hostname, port: ports.mgmt }),
        md: url.format({ protocol, slashes, hostname, port: ports.md }),
        bg: url.format({ protocol, slashes, hostname, port: ports.bg }),
        hosted_agents: url.format({ protocol, slashes, hostname, port: ports.hosted_agents }),
        master: url.format({ protocol, slashes, hostname, port: ports.mgmt })
    };
}

function new_router_from_address_list(address_list, hint) {
    return {
        default: get_base_address(address_list, { hint, api: 'mgmt' }).toString(),
        md: get_base_address(address_list, { hint, api: 'md' }).toString(),
        bg: get_base_address(address_list, { hint, api: 'bg' }).toString(),
        hosted_agents: get_base_address(address_list, { hint, api: 'hosted_agents' }).toString(),
        master: get_base_address(address_list, { hint, api: 'mgmt' }).toString()
    };
}

/**
 * Builds the RPC routing table from process environment addresses.
 * Used by endpoint and BG workers. WebServer applies BG_ADDR selectively.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{
 *   default: string,
 *   md: string,
 *   bg: string,
 *   hosted_agents: string,
 *   master: string,
 *   syslog: string,
 * }}
 */
function new_router_from_env(env = process.env) {
    const hostname = 'localhost';
    const ports = get_default_ports();

    // for dev (when env.MD_ADDR is not set) we increment md port to
    // make it route to the s3 endpoints port rather than the default web server.
    ports.md += 1;

    return {
        default: env.MGMT_ADDR || format_base_address(hostname, ports.mgmt),
        md: env.MD_ADDR || format_base_address(hostname, ports.md),
        bg: env.BG_ADDR || format_base_address(hostname, ports.bg),
        hosted_agents: env.HOSTED_AGENTS_ADDR || format_base_address(hostname, ports.hosted_agents),
        master: env.MGMT_ADDR || format_base_address(hostname, ports.mgmt),
        syslog: env.SYSLOG_ADDR || 'udp://localhost:514',
    };
}

function new_rpc() {
    const routing_table = new_router_from_address_list([], 'LOOPBACK');
    return new_rpc_from_routing(routing_table);
}

function new_rpc_from_base_address(base_address, routing_hint) {
    if (!routing_hint) {
        throw new Error('Routing hint was not provided');
    }

    // Create a routing table derived from the base address and default port offsets.
    const routing_table = new_router_from_base_address(base_address);
    const rpc = new_rpc_from_routing(routing_table);
    rpc.routing_hint = routing_hint;
    return rpc;
}

function new_rpc_from_routing(routing_table) {
    if (!routing_table) {
        throw new TypeError(`Invalid new_router: ${routing_table}`);
    }

    return new RPC({
        schema: api_schema,
        router: routing_table,
        api_routes: {
            object_api: 'md',
            func_api: 'md',
            scrubber_api: 'bg',
            replication_api: 'bg',
            archive_api: 'bg',
            hosted_agents_api: 'hosted_agents',
            node_api: 'master',
            host_api: 'master'
        }
    });
}

/**
 *
 * The following sets all routes to use only the default base address.
 *
 * This mode is needed for the frontend browser (see reason below),
 * and we must assure the default base address will serve all the apis
 * needed by the frontend.
 *
 * The reason for this is that the browser does not allow to connect to wss:// host
 * that has self-signed certificate, other than the page host.
 * Trying to do so will immediately error with "WebSocket opening handshake was canceled".
 *
 */
function new_rpc_default_only(base_address) {
    return new RPC({
        schema: api_schema,
        router: {
            default: base_address
        },
        api_routes: {}
    });
}

exports.new_rpc = new_rpc;
exports.new_rpc_from_base_address = new_rpc_from_base_address;
exports.new_rpc_from_routing = new_rpc_from_routing;
exports.new_rpc_default_only = new_rpc_default_only;
exports.new_router_from_address_list = new_router_from_address_list;
exports.new_router_from_base_address = new_router_from_base_address;
exports.new_router_from_env = new_router_from_env;
exports.get_schema = get_schema;
