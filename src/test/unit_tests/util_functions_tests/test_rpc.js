/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 700]*/
'use strict';

process.env.DEBUG_MODE = true;

const _ = require('lodash');
const net = require('net');
const mocha = require('mocha');
const assert = require('assert');
const { mock } = require('node:test');
// @ts-ignore no @types/ws in this repo
const WS = require('ws');

const config = require('../../../../config');
const ssl_utils = require('../../../util/ssl_utils');
const RpcN2NAgent = require('../../../rpc/rpc_n2n_agent');
const RpcN2NConnection = require('../../../rpc/rpc_n2n');
const n2n_wss = require('../../../rpc/n2n_wss');
const { RPC, RpcError, RpcSchema, RPC_BUFFERS } = require('../../../rpc');

function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}

mocha.describe('RPC', function() {

    const test_api = {

        $id: 'test_api',

        methods: {
            get: {
                method: 'GET',
                params: {
                    $ref: '#/definitions/params'
                },
                reply: {
                    $ref: '#/definitions/reply'
                },
                doc: 'get doc',
                auth: false,
            },
            post: {
                method: 'POST',
                params: {
                    $ref: '#/definitions/params'
                },
                reply: {
                    $ref: '#/definitions/reply'
                },
                doc: 'post doc',
                auth: false,
            },
            put: {
                method: 'PUT',
                params: {
                    $ref: '#/definitions/params'
                },
                reply: {
                    $ref: '#/definitions/reply'
                },
                doc: 'put doc',
                auth: false,
            },
            delete: {
                method: 'DELETE',
                params: {
                    $ref: '#/definitions/params'
                },
                reply: {
                    $ref: '#/definitions/reply'
                },
                doc: 'del doc',
                auth: false,
            },
        },

        definitions: {

            params: {
                type: 'object',
                required: ['param1', 'param2', 'param3', 'param4'],
                properties: {
                    param1: {
                        type: 'string',
                    },
                    param2: {
                        type: 'number',
                    },
                    param3: {
                        type: 'boolean',
                    },
                    param4: {
                        idate: true
                    },
                    param5: {
                        type: 'array',
                        items: {
                            type: 'integer'
                        }
                    },
                    // test arrays of objects with buffers inside
                    param6: {
                        $ref: 'common_test_api#/definitions/params6'
                    },
                    // test array of buffers
                    param7: {
                        type: 'array',
                        items: {
                            $ref: 'common_test_api#/definitions/params7'
                        }
                    },
                }
            },

            reply: {
                type: 'object',
                required: ['rest'],
                properties: {
                    rest: {
                        type: 'array',
                        items: {
                            oneOf: [{
                                type: 'string'
                            }, {
                                type: 'object',
                                properties: {
                                    fucking: {
                                        type: 'string'
                                    }
                                }
                            }]
                        }
                    }
                }
            },

        },
    };

    const common_test_api = {

        $id: 'common_test_api',

        definitions: {

            params6: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        subarray: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    stam: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            },

            params7: {
                type: 'object',
                properties: {
                    sub: {
                        $ref: '#/definitions/sub',
                    },
                }
            },

            sub: {
                type: 'object',
                properties: {
                    substam: { type: 'string' }
                }
            },

        },
    };

    // test data
    const PARAMS = {
        param1: '1',
        param2: 2,
        param3: true,
        param4: Date.now(),
        param5: [1, 2, 3],
        param6: [{
            subarray: ['g', 'u', 'y'].map(ch => ({
                stam: Buffer.alloc(ch.charCodeAt(0), ch).toString('hex')
            })),
        }, {
            subarray: ['m', 'a', 'r'].map(ch => ({
                stam: Buffer.alloc(ch.charCodeAt(0) * 10, ch).toString('base64')
            })),
        }, {
            subarray: []
        }],
        param7: ['a', 'b', 'z'].map(ch => ({
            sub: {
                substam: Buffer.alloc(ch.charCodeAt(0), ch).toString('hex')
            }
        })),
    };
    const REPLY = {
        rest: ['IS', {
            fucking: 'aWeSoMe'
        }]
    };
    const ERROR_MESSAGE = 'THIS IS AN EXPECTED TEST ERROR';
    const ERROR_CODE = 'TEST_CODE';
    const schema = new RpcSchema();
    schema.register_api(test_api);
    schema.register_api(common_test_api);
    schema.compile();

    /** @type {InstanceType<typeof RPC>} */
    let rpc;
    let client;

    function make_server() {
        const server = {
            throw: false,
            common(req) {
                assert.deepStrictEqual(Object.keys(PARAMS), Object.keys(req.rpc_params));
                _.each(PARAMS, function(param, name) {
                    assert.deepEqual(param, req.rpc_params[name]);
                });
                assert.deepStrictEqual(PARAMS, _.omit(req.rpc_params, RPC_BUFFERS));
                if (server.throw) throw new RpcError(ERROR_CODE, ERROR_MESSAGE);
                return _.cloneDeep(REPLY);
            },
            get(req) {
                return server.common(req);
            },
            post(req) {
                return server.common(req);
            },
            put(req) {
                return server.common(req);
            },
            delete(req) {
                return server.common(req);
            },
        };
        return server;
    }

    mocha.beforeEach('test_rpc.beforeEach', function() {
        rpc = new RPC({
            schema,
            router: {
                default: 'fcall://fcall'
            },
        });
        client = rpc.new_client({
            address: 'fcall://fcall'
        });
    });

    mocha.afterEach('test_rpc.afterEach', function() {
        rpc.disconnect_all();
        client = null;
    });


    mocha.describe('schema.register_api', function() {

        mocha.it('should detect api with bad method', function() {
            assert.throws(function() {
                const bad_schema = new RpcSchema();
                bad_schema.register_api({
                    $id: 'test_bad_api',
                    methods: {
                        a: {
                            method: 'POSTER',
                        }
                    }
                });
                bad_schema.compile();
            });
        });

    });

    mocha.describe('register_service', function() {

        mocha.it('should work on empty server with allow_missing_methods', function() {
            rpc.register_service(test_api, {}, {
                allow_missing_methods: true
            });
        });

        mocha.it('should detect missing api func', function() {
            // check that missing functions are detected
            assert.throws(function() {
                rpc.register_service(test_api, {});
            }, Error);
        });

        mocha.it('should throw on duplicate service', function() {
            rpc.register_service(test_api, {}, {
                peer: 17,
                allow_missing_methods: true
            });
            assert.throws(function() {
                rpc.register_service(test_api, {}, {
                    peer: 17,
                    allow_missing_methods: true
                });
            }, Error);
        });

        mocha.it('should work on mock server', function() {
            const server = {
                get: function() { /* Empty Func */ },
                put: function() { /* Empty Func */ },
                post: function() { /* Empty Func */ },
                delete: function() { /* Empty Func */ },
                use: function() { /* Empty Func */ },
            };
            rpc.register_service(test_api, server);
        });

    });


    mocha.describe('calling RPC methods', function() {

        // create a test for every api function
        _.forEach(test_api.methods,
            (xx, method_name) => mocha.describe(method_name, function() {

                mocha.it('should call and get reply', function() {
                    const server = make_server();
                    server.throw = false;
                    rpc.register_service(test_api, server);
                    return client.test[method_name](_.cloneDeep(PARAMS))
                        .then(res => {
                            assert.deepEqual(res, REPLY);
                        }, err => {
                            log('UNEXPECTED ERROR', err, err.stack);
                            throw new Error('UNEXPECTED ERROR');
                        });
                });

                mocha.it('should call and get error', function() {
                    const server = make_server();
                    server.throw = true;
                    rpc.register_service(test_api, server);
                    return client.test[method_name](_.cloneDeep(PARAMS))
                        .then(res => {
                            log('UNEXPECTED REPLY', res);
                            throw new Error('UNEXPECTED REPLY');
                        }, err => {
                            assert.deepEqual(err.rpc_code, ERROR_CODE);
                            assert.deepEqual(err.message, ERROR_MESSAGE);
                        });
                });

            }));
    });

    mocha.describe('attachments', function() {

        mocha.it('should send/receive attachments in params/reply', function() {
            const server = make_server();
            const params = _.cloneDeep(PARAMS);
            const params_attachments = {
                buffer1: Buffer.alloc(1024, 'testing params attachments!\n'),
                another_buffer: Buffer.alloc(1024, 'I am just another buffer!\n'),
            };
            const reply_attachments = {
                buffer2: Buffer.alloc(1024, 'testing reply attachments!\n'),
                different_buffer: Buffer.alloc(1024, 'I am just a different buffer!\n'),
            };
            params[RPC_BUFFERS] = params_attachments;
            let received = false;
            server.put = req => {
                const reply = server.common(req);
                const received_params_attachments = req.rpc_params[RPC_BUFFERS];
                log('received_params_attachments', received_params_attachments);
                assert(_.isEqual(params_attachments, received_params_attachments));
                reply[RPC_BUFFERS] = reply_attachments;
                received = true;
                return reply;
            };
            rpc.register_service(test_api, server);
            return client.test.put(params)
                .then(reply => {
                    assert(received);
                    const received_reply_attachments = reply[RPC_BUFFERS];
                    log('received_reply_attachments', received_reply_attachments);
                    assert(_.isEqual(reply_attachments, received_reply_attachments));
                });
        });

    });

    mocha.it('Testing HTTP/WS', function() {
        rpc.register_service(test_api, make_server());
        let http_server;
        let http_client;
        let ws_client;
        return rpc.start_http_server({
                port: 0,
                protocol: 'ws:',
                logging: true,
            })
            .then(http_server_arg => {
                http_server = http_server_arg;
                http_client = rpc.new_client({
                    address: 'http://localhost:' + http_server.address().port
                });
                ws_client = rpc.new_client({
                    address: 'ws://localhost:' + http_server.address().port
                });
            })
            .then(() => http_client.test.get(_.cloneDeep(PARAMS)))
            .then(() => ws_client.test.get(_.cloneDeep(PARAMS)))
            .then(() => http_server.close());
    });

    mocha.it('Testing HTTPS/WSS', function() {
        rpc.register_service(test_api, make_server());
        let https_server;
        let https_client;
        let wss_client;
        return rpc.start_http_server({
                port: 0,
                protocol: 'wss:',
                logging: true,
            })
            .then(https_server_arg => {
                https_server = https_server_arg;
                https_client = rpc.new_client({
                    address: 'https://localhost:' + https_server.address().port
                });
                wss_client = rpc.new_client({
                    address: 'wss://localhost:' + https_server.address().port
                });
            })
            .then(() => https_client.test.get(_.cloneDeep(PARAMS)))
            .then(() => wss_client.test.get(_.cloneDeep(PARAMS)))
            .then(() => https_server.close());
    });

    mocha.it('Testing TCP', function() {
        rpc.register_service(test_api, make_server());
        let tcp_server;
        return rpc.register_tcp_transport(0)
            .then(tcp_server_arg => {
                tcp_server = tcp_server_arg;
                const tcp_client = rpc.new_client({
                    address: 'tcp://localhost:' + tcp_server.port
                });
                return tcp_client.test.get(_.cloneDeep(PARAMS));
            })
            .finally(() => {
                if (tcp_server) tcp_server.close();
            });
    });

    mocha.it('Testing TLS', async function() {
        rpc.register_service(test_api, make_server());
        let tls_server;
        try {
            const tls_server_arg = await rpc.register_tcp_transport(0, ssl_utils.generate_ssl_certificate());
            tls_server = tls_server_arg;
            const tls_client = rpc.new_client({
                address: 'tls://localhost:' + tls_server.port
            });
            return await tls_client.test.get(_.cloneDeep(PARAMS));
        } finally {
            if (tls_server) tls_server.close();
        }
    });

    mocha.describe('N2N transports', function() {
        /** @type {boolean} */
        let rollback_prev;

        mocha.beforeEach(function() {
            rollback_prev = config.ROLLBACK_N2N_TO_ICE;
        });

        // Close connections while ROLLBACK_N2N_TO_ICE still matches this test, then restore.
        // Avoids async closes from the previous test running under the next test's flag.
        mocha.afterEach(async function() {
            if (rpc) rpc.disconnect_all();
            await new Promise(resolve => setImmediate(resolve));
            config.ROLLBACK_N2N_TO_ICE = rollback_prev;
        });

        mocha.it('N2N WSS', async function() {
            config.ROLLBACK_N2N_TO_ICE = false;
            rpc.register_service(test_api, make_server());
            const ADDR_A = 'n2n://testrpc';
            const ADDR_B = 'n2n://testrpc-b';

            // Route n2n_signal by target (core does this in production via nodes_monitor).
            /** @type {{ a: InstanceType<typeof RpcN2NAgent>, b: InstanceType<typeof RpcN2NAgent> }} */
            const n2n_agents = /** @type {any} */ ({});
            /**
             * Deliver signal to the agent that owns params.target
             * @param {{ target: string }} params
             */
            function route_n2n_signal(params) {
                if (params.target === ADDR_B) return n2n_agents.b.accept_signal(params);
                return n2n_agents.a.accept_signal(params);
            }

            // Dialer: must register on this rpc so n2n:// clients use A (same as production agents).
            n2n_agents.a = rpc.register_n2n_agent(route_n2n_signal);
            n2n_agents.a.set_rpc_address(ADDR_A);
            // In-process dialer+acceptor: allow loopback endpoints.
            n2n_agents.a.update_n2n_config({ offer_internal: true });

            // Acceptor peer B: rpc keeps only one n2n_agent, so construct a second agent.
            n2n_agents.b = new RpcN2NAgent({
                send_signal: route_n2n_signal,
            });
            n2n_agents.b.set_rpc_address(ADDR_B);
            n2n_agents.b.update_n2n_config({ offer_internal: true });
            // register_n2n_agent would wire this for A; do it by hand for B.
            n2n_agents.b.on('connection', conn => rpc._accept_new_connection(conn));

            const ssl_context = ssl_utils.generate_ssl_certificate();
            await n2n_agents.a.start_shared_wss_listen(0, ssl_context);
            await n2n_agents.b.start_shared_wss_listen(0, ssl_context);
            assert.strictEqual(n2n_agents.a.n2n_config.wss_port, n2n_agents.b.n2n_config.wss_port);

            try {
                // Dial A→B over the shared WSS listen.
                /** @type {any} */
                const n2n_client_b = rpc.new_client({ address: ADDR_B });
                const res = await n2n_client_b.test.get(_.cloneDeep(PARAMS));
                assert.deepEqual(res, REPLY);
            } finally {
                // Close N2N conns under ROLLBACK_N2N_TO_ICE=false before tearing down listen
                rpc.disconnect_all();
                n2n_agents.b.stop_wss_server();
                n2n_agents.a.stop_wss_server();
                // Allow async ws/tls close to finish so mocha can exit without --exit
                await new Promise(resolve => setImmediate(resolve));
            }
        });

        mocha.it('N2N WSS accepts only one handshake per session', async function() {
            config.ROLLBACK_N2N_TO_ICE = false;
            const ADDR = 'n2n://acceptor';
            const n2n_agent = new RpcN2NAgent({
                send_signal: async () => {
                    throw new Error('Signaling is not used in this handshake test');
                },
            });
            n2n_agent.set_rpc_address(ADDR);
            /** @type {any[]} */
            const sockets = [];
            /** @type {import('../../../rpc/rpc_n2n')[]} */
            const connections = [];
            n2n_agent.on('connection', conn => connections.push(conn));
            try {
                const ssl_context = ssl_utils.generate_ssl_certificate();
                const port = await n2n_agent.start_shared_wss_listen(0, ssl_context); // port 0 asks the OS to choose an available port
                const local_info = await n2n_agent.accept_signal({
                    source: 'n2n://dialer', target: ADDR, info: {},
                });
                assert.ok('session_id' in local_info && typeof local_info.session_id === 'string');
                const { session_id } = local_info;
                const results = await Promise.all([0, 1, 2].map(() => {
                    const ws = new WS(`wss://127.0.0.1:${port}`, {
                        rejectUnauthorized: false,
                        handshakeTimeout: 2000,
                        headers: { [n2n_wss.SESSION_HEADER]: session_id },
                    });
                    sockets.push(ws);
                    return new Promise(resolve => {
                        ws.once('open', () => resolve('open'));
                        ws.once('error', err => resolve(err.message));
                    });
                }));
                assert.strictEqual(results.filter(result => result === 'open').length, 1);
                assert.strictEqual(results.filter(result => result === 'Unexpected server response: 401').length, 2);
                assert.strictEqual(connections.length, 1);
                assert.strictEqual(connections[0].ws.readyState, WS.OPEN);
            } finally {
                // Register close listeners before cleanup so no socket close event is missed.
                const socket_close_promises = [...sockets, ...connections.map(conn => conn.ws)]
                    .filter(ws => ws && ws.readyState !== WS.CLOSED)
                    .map(ws => new Promise(resolve => ws.once('close', () => resolve(undefined))));
                for (const conn of connections) conn.close();
                for (const ws of sockets) ws.terminate();
                n2n_agent.stop_wss_server();
                await Promise.all(socket_close_promises);
            }
        });

        mocha.it('N2N WSS port fallback on EADDRINUSE', async function() {
            config.ROLLBACK_N2N_TO_ICE = false;
            const range_min_prev = config.AGENT_RPC_PORT_RANGE_MIN;
            const range_max_prev = config.AGENT_RPC_PORT_RANGE_MAX;

            // Occupy one port (all interfaces, same as https.listen(port)), then ask WSS
            // to start there with a tiny fallback range.
            const blocker = net.createServer();
            await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
                blocker.once('error', reject);
                blocker.listen(0, () => resolve());
            }));
            const occupied_port = /** @type {import('net').AddressInfo} */ (blocker.address()).port;
            config.AGENT_RPC_PORT_RANGE_MIN = occupied_port;
            config.AGENT_RPC_PORT_RANGE_MAX = occupied_port + 2; // 3 ports: busy + two fallbacks

            const n2n_agent = new RpcN2NAgent({
                send_signal: async () => {
                    throw new Error('signal not used in listen test');
                },
            });
            const ssl_context = ssl_utils.generate_ssl_certificate();
            try {
                const bound_port = await n2n_agent.start_shared_wss_listen(occupied_port, ssl_context);
                assert.notStrictEqual(bound_port, occupied_port);
                assert.ok(
                    bound_port > config.AGENT_RPC_PORT_RANGE_MIN &&
                    bound_port <= config.AGENT_RPC_PORT_RANGE_MAX
                );
                assert.strictEqual(n2n_agent.n2n_config.wss_port, bound_port);
            } finally {
                n2n_agent.stop_wss_server();
                config.AGENT_RPC_PORT_RANGE_MIN = range_min_prev;
                config.AGENT_RPC_PORT_RANGE_MAX = range_max_prev;
                await new Promise(resolve => blocker.close(resolve));
            }
        });

        // mocha.it('N2N UDP', n2n_ice_tester({
        //     udp_port: true,
        //     tcp_active: false,
        //     tcp_permanent_passive: false,
        //     tcp_transient_passive: false,
        //     tcp_simultaneous_open: false,
        // }));
        mocha.it('N2N ICE TCP', n2n_ice_tester({
            tcp_active: true,
            tcp_permanent_passive: {
                min: 40400,
                max: 50500,
            },
            tcp_tls: false,
            udp_port: false,
        }));

        mocha.it('N2N ICE TLS', n2n_ice_tester({
            tcp_active: true,
            tcp_permanent_passive: {
                min: 40400,
                max: 50500,
            },
            tcp_tls: true,
            udp_port: false,
        }));

        /**
         * Run an N2N RPC call over legacy ICE with ROLLBACK_N2N_TO_ICE enabled for the test
         * @param {object} n2n_config
         * @returns {function(): Promise}
         */
        function n2n_ice_tester(n2n_config) {
            return async function() {
                config.ROLLBACK_N2N_TO_ICE = true;
                rpc.register_service(test_api, make_server());
                let tcp_server;
                const ADDR = 'n2n://testrpc';
                const n2n_agent = rpc.register_n2n_agent(params => rpc.accept_n2n_signal(params));
                n2n_agent.set_rpc_address(ADDR);
                n2n_agent.update_n2n_config(n2n_config);
                try {
                    tcp_server = await rpc.register_tcp_transport(0);
                    /** @type {any} */
                    const n2n_client = rpc.new_client({
                        address: ADDR
                    });
                    const res = await n2n_client.test.get(_.cloneDeep(PARAMS));
                    assert.deepEqual(res, REPLY);
                } finally {
                    // Close N2N conns under ROLLBACK_N2N_TO_ICE=true before resetting port config
                    rpc.disconnect_all();
                    if (tcp_server) tcp_server.close();
                    n2n_agent.update_n2n_config({
                        tcp_permanent_passive: false
                    });
                }
            };
        }
    });

});

mocha.describe('N2N WSS connection and session handling', function() {
    /** @type {boolean} */
    let rollback_prev;
    /** @type {RpcN2NAgent[]} */
    let agents;
    /** @type {RpcN2NConnection[]} */
    let connection_objects;
    /** @type {any[]} */
    let sockets;

    mocha.beforeEach(function() {
        rollback_prev = config.ROLLBACK_N2N_TO_ICE;
        config.ROLLBACK_N2N_TO_ICE = false;
        agents = [];
        connection_objects = [];
        sockets = [];
    });

    mocha.afterEach(async function() {
        try {
            // Register listeners before closing either side so no close event is missed.
            const socket_close_promises = [...sockets, ...connection_objects.map(conn => conn.ws)]
                .filter(ws => ws && ws.readyState !== WS.CLOSED)
                .map(ws => new Promise(resolve => ws.once('close', () => resolve(undefined))));
            for (const conn of connection_objects) conn.close();
            for (const ws of sockets) ws.terminate();
            for (const agent of agents) agent.stop_wss_server();
            await Promise.all(socket_close_promises);
            for (const agent of agents) {
                assert.strictEqual(agent._pending_sessions.size, 0);
                assert.strictEqual(agent.listenerCount('reset_n2n'), 0);
            }
        } finally {
            config.ROLLBACK_N2N_TO_ICE = rollback_prev;
        }
    });

    /** @param {string} address */
    function create_agent(address) {
        const agent = new RpcN2NAgent({
            send_signal: async () => {
                throw new Error('Signaling is not used in this regression test');
            },
        });
        agents.push(agent);
        agent.set_rpc_address(address);
        agent.update_n2n_config({ offer_internal: true });
        agent.on('connection', conn => connection_objects.push(conn));
        return agent;
    }

    /** @param {RpcN2NAgent} agent */
    function create_connection(agent) {
        const conn = new RpcN2NConnection(new URL('n2n://dialer'), agent);
        connection_objects.push(conn);
        return conn;
    }

    /**
     * @param {RpcN2NAgent} agent
     * @param {string} source
     */
    async function create_pending_session(agent, source) {
        const target = agent.rpc_address;
        assert.ok(typeof target === 'string');
        const reply = await agent.accept_signal({ source, target, info: {} });
        assert.ok('session_id' in reply && typeof reply.session_id === 'string');
        return reply.session_id;
    }

    /**
     * @param {number} port
     * @param {string} [session_id]
     * @returns {Promise<any>}
     */
    function open_socket(port, session_id) {
        const ws = new WS(`wss://127.0.0.1:${port}`, {
            rejectUnauthorized: false,
            handshakeTimeout: 2000,
            headers: session_id ? { [n2n_wss.SESSION_HEADER]: session_id } : {},
        });
        sockets.push(ws);
        return new Promise((resolve, reject) => {
            ws.once('open', () => resolve(ws));
            ws.once('error', reject);
        });
    }

    /**
     * @param {'pending' | 'ready' | 'failed'} status
     * @returns {import('../../../rpc/n2n_wss').DialAttempt}
     */
    function make_attempt(status) {
        return { endpoint: 'wss://127.0.0.1:1', ws: null, status, opened: Promise.resolve() };
    }

    mocha.it('selects a ready dial without waiting for a pending dial', function() {
        const pending = make_attempt('pending');
        const ready = make_attempt('ready');
        assert.strictEqual(n2n_wss.find_dial_winner([pending, ready]), ready);
    });

    mocha.it('skips failed dials and selects the first ready dial', function() {
        const failed = make_attempt('failed');
        const first_ready = make_attempt('ready');
        const second_ready = make_attempt('ready');
        assert.strictEqual(n2n_wss.find_dial_winner([failed, first_ready, second_ready]), first_ready);
    });

    mocha.it('selects no winner when no dial is ready', function() {
        assert.strictEqual(n2n_wss.find_dial_winner([make_attempt('pending'), make_attempt('failed')]), undefined);
        assert.strictEqual(n2n_wss.find_dial_winner([make_attempt('failed')]), undefined);
        assert.strictEqual(n2n_wss.find_dial_winner([]), undefined);
    });

    mocha.it('rejects an unknown session token without consuming a valid session', async function() {
        const agent = create_agent('n2n://unknown-token');
        const port = await agent.start_shared_wss_listen(0, ssl_utils.generate_ssl_certificate());
        const session_id = await create_pending_session(agent, 'n2n://dialer');
        await assert.rejects(open_socket(port, 'unknown-session'), /Unexpected server response: 401/);
        assert.strictEqual(connection_objects.length, 0);
        assert.ok(agent._pending_sessions.has(session_id));
        await open_socket(port, session_id);
        assert.strictEqual(connection_objects.length, 1);
    });

    mocha.it('rejects an upgrade without a session token', async function() {
        const agent = create_agent('n2n://missing-token');
        const port = await agent.start_shared_wss_listen(0, ssl_utils.generate_ssl_certificate());
        await assert.rejects(open_socket(port), /Unexpected server response: 401/);
        assert.strictEqual(connection_objects.length, 0);
    });

    mocha.it('rejects reuse of a session token after a successful connection', async function() {
        const agent = create_agent('n2n://replayed-token');
        const port = await agent.start_shared_wss_listen(0, ssl_utils.generate_ssl_certificate());
        const session_id = await create_pending_session(agent, 'n2n://dialer');
        const winner = await open_socket(port, session_id);
        await assert.rejects(open_socket(port, session_id), /Unexpected server response: 401/);
        assert.strictEqual(connection_objects.length, 1);
        assert.strictEqual(winner.readyState, WS.OPEN);
        assert.strictEqual(connection_objects[0].ws.readyState, WS.OPEN);
        /** @type {Promise<Buffer>} */
        const pong = new Promise(resolve => winner.once('pong', resolve));
        winner.ping('connection-still-active');
        const response = await pong;
        assert.strictEqual(response.toString(), 'connection-still-active');
        assert.strictEqual(agent._pending_sessions.size, 0);
    });

    mocha.it('expires an unused session and closes its waiting connection', async function() {
        const agent = create_agent('n2n://expired-session');
        const conn = create_connection(agent);
        /** @type {Error[]} */
        const errors = [];
        conn.on('error', (/** @type {Error} */ err) => errors.push(err));
        mock.timers.enable({ apis: ['setTimeout'] });
        try {
            agent.register_pending_session('unused-session', conn);
            mock.timers.tick(config.RPC_CONNECT_TIMEOUT - 1);
            assert.ok(agent._pending_sessions.has('unused-session'));
            assert.strictEqual(conn.is_closed(), false);
            mock.timers.tick(1);
            assert.strictEqual(agent._pending_sessions.size, 0);
            assert.strictEqual(conn.is_closed(), true);
            assert.strictEqual(errors.length, 1);
            assert.strictEqual(errors[0].message, 'N2N WSS ACCEPT TIMEOUT');
            assert.strictEqual(agent.listenerCount('reset_n2n'), 0);
        } finally {
            mock.timers.reset();
        }
    });

    mocha.it('routes different sessions on a shared listener to their owning agents', async function() {
        const agent_a = create_agent('n2n://acceptor-a');
        const agent_b = create_agent('n2n://acceptor-b');
        const ssl_context = ssl_utils.generate_ssl_certificate();
        const port_a = await agent_a.start_shared_wss_listen(0, ssl_context);
        const port_b = await agent_b.start_shared_wss_listen(0, ssl_context);
        assert.strictEqual(port_a, port_b);
        const session_a = await create_pending_session(agent_a, 'n2n://dialer-a');
        const session_b = await create_pending_session(agent_b, 'n2n://dialer-b');
        assert.notStrictEqual(session_a, session_b);
        // Dial B first so routing cannot accidentally succeed by choosing the first agent.
        const [socket_b, socket_a] = await Promise.all([open_socket(port_b, session_b), open_socket(port_a, session_a)]);
        assert.strictEqual(connection_objects.length, 2);
        for (const [agent, socket, source] of [
            [agent_a, socket_a, 'n2n://dialer-a'],
            [agent_b, socket_b, 'n2n://dialer-b'],
        ]) {
            const owned = connection_objects.filter(conn => conn.n2n_agent === agent);
            assert.strictEqual(owned.length, 1);
            assert.strictEqual(owned[0].url.href, source);
            assert.strictEqual(owned[0].ws._socket.remotePort, socket._socket.localPort);
            assert.strictEqual(owned[0].ws.readyState, WS.OPEN);
        }
    });

    mocha.it('rejects an ICE offer without starting a listener or registering a session', async function() {
        const ADDR = 'n2n://ice-offer';
        const agent = create_agent(ADDR);
        agent.ensure_wss_listening = async () => assert.fail('ICE offers must be rejected before waiting for the listener');
        agent.register_pending_session = () => assert.fail('ICE offers must not register a session');
        await assert.rejects(async () => agent.accept_signal({
            source: 'n2n://ice-dialer', target: ADDR,
            info: { credentials: { ufrag: 'legacy', pwd: 'legacy-password' }, candidates: {} },
        }), /N2N WSS PEER STILL ON ICE/);
        assert.strictEqual(agent._pending_sessions.size, 0);
        assert.strictEqual(agent.listenerCount('reset_n2n'), 0);
    });

    mocha.it('cleans up the connection when accept fails asynchronously', async function() {
        const ADDR = 'n2n://failed-accept';
        const agent = create_agent(ADDR);
        const failure = new Error('test listener failure');
        agent.ensure_wss_listening = async () => {
            throw failure;
        };
        await assert.rejects(async () => agent.accept_signal({
            source: 'n2n://dialer', target: ADDR, info: {},
        }), err => err === failure);
        assert.strictEqual(agent._pending_sessions.size, 0);
        assert.strictEqual(agent.listenerCount('reset_n2n'), 0);
    });

    mocha.it('cleans up the connection when accept throws synchronously', async function() {
        const ADDR = 'n2n://throwing-accept';
        const agent = create_agent(ADDR);
        const failure = new Error('test synchronous accept failure');
        const original_accept = RpcN2NConnection.prototype.accept;
        try {
            RpcN2NConnection.prototype.accept = function() {
                connection_objects.push(this);
                throw failure;
            };
            await assert.rejects(async () => agent.accept_signal({
                source: 'n2n://dialer', target: ADDR, info: {},
            }), err => err === failure);
            assert.strictEqual(connection_objects.length, 1);
            assert.strictEqual(connection_objects[0].is_closed(), true);
            assert.strictEqual(agent.listenerCount('reset_n2n'), 0);
        } finally {
            RpcN2NConnection.prototype.accept = original_accept;
        }
    });

    mocha.it('does not register a session if the connection closes while waiting for the listener', async function() {
        const agent = create_agent('n2n://closed-during-accept');
        const conn = create_connection(agent);
        /** @type {(port: number) => void} */
        let resolve_listening = () => assert.fail('Listener promise has not been initialized');
        /** @type {Promise<number>} */
        const listening = new Promise(resolve => {
            resolve_listening = resolve;
        });
        agent.ensure_wss_listening = () => listening;
        agent.register_pending_session = () => assert.fail('A closed connection must not register a session');
        const accepting = n2n_wss.accept(conn, {});
        conn.close();
        resolve_listening(0);
        await assert.rejects(accepting, /N2N WSS CONNECTION CLOSED DURING ACCEPT/);
        assert.strictEqual(agent._pending_sessions.size, 0);
    });
});
