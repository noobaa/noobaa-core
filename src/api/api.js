/* Copyright (C) 2016 NooBaa */
'use strict';

const url = require('url');
const { RPC, RPC_BUFFERS, RpcSchema } = require('../rpc');
const { get_base_address, get_default_ports } = require('../util/addr_utils');

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
api_schema.register_api(require('./frontend_notifications_api'));
api_schema.register_api(require('./func_api'));
api_schema.register_api(require('./func_node_api'));
api_schema.compile();

const client_factory = client_factory_from_schema(api_schema);

function client_factory_from_schema(schema) {
    const client_proto = {
        RPC_BUFFERS,

        async create_auth_token(params) {
            const res = await this.auth.create_auth(params);
            this.options.auth_token = res.token;
            return res;
        },

        async create_access_key_auth(params) {
            const res = await this.auth.create_access_key_auth(params);
            this.options.auth_token = res.token;
            return res;
        },

        async create_k8s_auth(params) {
            const res = await this.auth.create_k8s_auth(params);
            this.options.auth_token = res.token;
            return res;
        },

        _invoke_api(api, method_api, params, options) {
            options = Object.assign(
                Object.create(this.options),
                options
            );
            return this.rpc._request(api, method_api, params, options);
        }
    };

    for (const api of Object.values(schema)) {
        if (!api || !api.id || api.id[0] === '_') {
            continue;
        }

        // Skip common api and other apis that do not define methods.
        if (!api.methods) {
            continue;
        }

        const name = api.id.replace(/_api$/, '');
        if (name === 'rpc' || name === 'options') {
            throw new Error('ILLEGAL API ID');
        }

        const api_proto = {};
        for (const [method_name, method_api] of Object.entries(api.methods)) {
            // The following getter is defined as a function and not as an arrow function
            // to prevent the capture of "this" from the surrounding context.
            // When invoked, "this" should be the client object. Using an arrow function
            // will capture the "this" defined in the invocation of "new_client_factory"
            // which is "undefined"
            api_proto[method_name] = function(params, options) {
                return this.client._invoke_api(api, method_api, params, options);
            };
        }

        // The following getter is defined as a function and not as an arrow function
        // on purpose. please see the last comment (above) for a detailed explanation.
        Object.defineProperty(client_proto, name, {
            enumerable: true,
            get: function() {
                const api_instance = Object.create(api_proto);
                api_instance.client = this;
                return Object.freeze(api_instance);
            }
        });
    }

    return (rpc, options) => {
        const client = Object.create(client_proto);
        client.rpc = rpc;
        client.options = options ? Object.create(options) : {};
        return client;
    };
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
        client_factory,
        schema: api_schema,
        router: routing_table,
        api_routes: {
            object_api: 'md',
            func_api: 'md',
            scrubber_api: 'bg',
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
        client_factory,
        schema: api_schema,
        router: {
            default: base_address
        },
        api_routes: {}
    });
}

exports.client_factory_from_schema = client_factory_from_schema;
exports.new_rpc = new_rpc;
exports.new_rpc_from_base_address = new_rpc_from_base_address;
exports.new_rpc_from_routing = new_rpc_from_routing;
exports.new_rpc_default_only = new_rpc_default_only;
exports.new_router_from_address_list = new_router_from_address_list;
exports.new_router_from_base_address = new_router_from_base_address;
