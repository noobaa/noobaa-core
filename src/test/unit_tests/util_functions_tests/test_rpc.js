/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 700]*/
'use strict';

process.env.DEBUG_MODE = true;

const _ = require('lodash');
const net = require('net');
const mocha = require('mocha');
const assert = require('assert');

const config = require('../../../../config');
const ssl_utils = require('../../../util/ssl_utils');
const RpcN2NAgent = require('../../../rpc/rpc_n2n_agent');
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
        rpc = null;
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
        let rollback_prev;

        mocha.beforeEach(function() {
            rollback_prev = config.ROLLBACK_TO_ICE;
        });

        // Close connections while ROLLBACK_TO_ICE still matches this test, then restore.
        // Avoids async closes from the previous test running under the next test's flag.
        mocha.afterEach(async function() {
            if (rpc) rpc.disconnect_all();
            await new Promise(resolve => setImmediate(resolve));
            config.ROLLBACK_TO_ICE = rollback_prev;
        });

        mocha.it('N2N WSS', async function() {
            config.ROLLBACK_TO_ICE = false;
            rpc.register_service(test_api, make_server());
            const ADDR_A = 'n2n://testrpc';
            const ADDR_B = 'n2n://testrpc-b';

            // Route n2n_signal by target (core does this in production via nodes_monitor).
            // Holder avoids TDZ while both agents share the same router closure.
            const n2n_agents = {
                /** @type {InstanceType<typeof RpcN2NAgent>} */
                a: undefined,
                /** @type {InstanceType<typeof RpcN2NAgent>} */
                b: undefined,
            };
            /**
             * Deliver signal to the agent that owns params.target
             * @param {object} params
             */
            function route_n2n_signal(params) {
                if (params.target === ADDR_B) return n2n_agents.b.accept_signal(params);
                return n2n_agents.a.accept_signal(params);
            }

            n2n_agents.a = rpc.register_n2n_agent(params => route_n2n_signal(params));
            n2n_agents.a.set_rpc_address(ADDR_A);
            // Unit test runs dialer+acceptor in-process; allow loopback endpoints.
            n2n_agents.a.update_n2n_config({ offer_internal: true });

            // Second agent joins the same process listen (hosted-agents style).
            // register_n2n_agent only keeps one agent per RPC, so construct directly.
            n2n_agents.b = new RpcN2NAgent({
                send_signal: params => route_n2n_signal(params),
            });
            n2n_agents.b.set_rpc_address(ADDR_B);
            n2n_agents.b.update_n2n_config({ offer_internal: true });
            // Accept-side connections from peer dials must register on the same RPC.
            n2n_agents.b.on('connection', conn => rpc._accept_new_connection(conn));

            const ssl_context = ssl_utils.generate_ssl_certificate();
            await n2n_agents.a.start_shared_wss_listen(0, ssl_context);
            await n2n_agents.b.start_shared_wss_listen(0, ssl_context);
            assert.strictEqual(n2n_agents.a.n2n_config.wss_port, n2n_agents.b.n2n_config.wss_port);

            try {
                // Peer path: dial A→B over shared WSS (session demux to agent B).
                // Prefer peer over self-connect: self-connect orphans the dialer under the
                // same n2n:// key when the accept side registers, which left open handles.
                const n2n_client_b = rpc.new_client({ address: ADDR_B });
                await n2n_client_b.test.get(_.cloneDeep(PARAMS));
            } finally {
                // Close N2N conns under ROLLBACK_TO_ICE=false before tearing down listen
                rpc.disconnect_all();
                n2n_agents.b.stop_wss_server();
                n2n_agents.a.stop_wss_server();
                // Allow async ws/tls close to finish so mocha can exit without --exit
                await new Promise(resolve => setImmediate(resolve));
            }
        });

        mocha.it('N2N WSS port fallback on EADDRINUSE', async function() {
            config.ROLLBACK_TO_ICE = false;
            const range_min_prev = config.AGENT_RPC_PORT_RANGE_MIN;
            const range_max_prev = config.AGENT_RPC_PORT_RANGE_MAX;

            // Occupy one port (all interfaces, same as https.listen(port)), then ask WSS
            // to start there with a tiny fallback range.
            const blocker = net.createServer();
            await new Promise((resolve, reject) => {
                blocker.once('error', reject);
                blocker.listen(0, resolve);
            });
            const occupied_port = blocker.address().port;
            config.AGENT_RPC_PORT_RANGE_MIN = occupied_port;
            config.AGENT_RPC_PORT_RANGE_MAX = occupied_port + 2;

            const n2n_agent = new RpcN2NAgent({
                send_signal: async () => {
                    throw new Error('signal not used in listen test');
                },
            });
            const ssl_context = ssl_utils.generate_ssl_certificate();
            try {
                const bound_port = await n2n_agent.start_shared_wss_listen(occupied_port, ssl_context);
                assert.notStrictEqual(bound_port, occupied_port);
                assert.ok(bound_port > occupied_port && bound_port <= occupied_port + 2);
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
         * Run an N2N RPC call over legacy ICE with ROLLBACK_TO_ICE enabled for the test
         * @param {object} n2n_config
         * @returns {function(): Promise}
         */
        function n2n_ice_tester(n2n_config) {
            return async function() {
                config.ROLLBACK_TO_ICE = true;
                rpc.register_service(test_api, make_server());
                let tcp_server;
                const ADDR = 'n2n://testrpc';
                const n2n_agent = rpc.register_n2n_agent(params => rpc.accept_n2n_signal(params));
                n2n_agent.set_rpc_address(ADDR);
                n2n_agent.update_n2n_config(n2n_config);
                try {
                    tcp_server = await rpc.register_tcp_transport(0);
                    const n2n_client = rpc.new_client({
                        address: ADDR
                    });
                    return await n2n_client.test.get(_.cloneDeep(PARAMS));
                } finally {
                    // Close N2N conns under ROLLBACK_TO_ICE=true before resetting port config
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
