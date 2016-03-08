'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
var assert = require('assert');
let pem = require('../util/pem');
var RPC = require('../rpc/rpc');
var RpcSchema = require('../rpc/rpc_schema');

mocha.describe('RPC', function() {

    // init the test api
    var test_api = {
        id: 'test_api',
        definitions: {
            params_schema: {
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
                        type: 'integer',
                        format: 'idate',
                    },
                    param5: {
                        type: 'array',
                    },
                }
            },
            reply_schema: {
                type: 'object',
                required: ['rest'],
                properties: {
                    rest: {
                        type: 'array',
                    }
                }
            },
        },
        methods: {
            get: {
                method: 'GET',
                params: {
                    $ref: '#/definitions/params_schema'
                },
                reply: {
                    $ref: '#/definitions/reply_schema'
                },
                doc: 'get doc',
                auth: false,
            },
            post: {
                method: 'POST',
                params: {
                    $ref: '#/definitions/params_schema'
                },
                reply: {
                    $ref: '#/definitions/reply_schema'
                },
                doc: 'post doc',
                auth: false,
            },
            put: {
                method: 'PUT',
                params: {
                    $ref: '#/definitions/params_schema'
                },
                reply: {
                    $ref: '#/definitions/reply_schema'
                },
                doc: 'put doc',
                auth: false,
            },
            delete: {
                method: 'DELETE',
                params: {
                    $ref: '#/definitions/params_schema'
                },
                reply: {
                    $ref: '#/definitions/reply_schema'
                },
                doc: 'del doc',
                auth: false,
            },
        }
    };

    // test data
    var PARAMS = {
        param1: '1',
        param2: 2,
        param3: true,
        param4: Date.now(),
        param5: [1, 2, 3],
    };
    var REPLY = {
        rest: ['IS', {
            fucking: 'aWeSoMe'
        }]
    };
    var ERROR_MESSAGE = 'THIS IS AN EXPECTED TEST ERROR';
    var ERROR_CODE = 'TEST_CODE';
    var schema = new RpcSchema();
    schema.register_api(test_api);
    schema.compile();

    var rpc;
    var client;

    mocha.beforeEach('test_rpc.afterEach', function() {
        rpc = new RPC({
            schema: schema,
            router: {
                default: 'fcall://fcall'
            }
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
                var bad_schema = new RpcSchema();
                bad_schema.register_api({
                    id: 'test_bad_api',
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
            var server = {
                get: function() {},
                put: function() {},
                post: function() {},
                delete: function() {},
                use: function() {},
            };
            rpc.register_service(test_api, server);
        });

    });


    mocha.describe('test_api round trip', function() {

        // create a test for every api function
        _.each(test_api.methods, function(method_api, method_name) {

            mocha.describe(method_name, function() {

                // init a server for the currently tested func.
                // we use a dedicated server per func so that all the other funcs
                // of the server return error in order to detect calling confusions.
                var reply_error = false;
                var methods = {};
                methods[method_name] = function(req) {
                    // console.log('TEST SERVER REQUEST');
                    _.each(PARAMS, function(param, name) {
                        assert.deepEqual(param, req.rpc_params[name]);
                    });
                    if (reply_error) {
                        throw req.rpc_error(ERROR_CODE, ERROR_MESSAGE, {
                            quiet: true,
                            nostack: true
                        });
                    } else {
                        return P.resolve(REPLY);
                    }
                };

                mocha.beforeEach(function() {
                    rpc.register_service(test_api, methods, {
                        allow_missing_methods: true
                    });
                });

                mocha.it('should call and get reply', function() {
                    reply_error = false;
                    return client.test[method_name](PARAMS).then(function(res) {
                        assert.deepEqual(res, REPLY);
                    }, function(err) {
                        console.log('UNEXPECTED ERROR', err, err.stack);
                        throw 'UNEXPECTED ERROR';
                    });
                });

                mocha.it('should call and get error', function() {
                    reply_error = true;
                    return client.test[method_name](PARAMS).then(function(res) {
                        console.log('UNEXPECTED REPLY', res);
                        throw 'UNEXPECTED REPLY';
                    }, function(err) {
                        assert.deepEqual(err.rpc_code, ERROR_CODE);
                        assert.deepEqual(err.message, ERROR_MESSAGE);
                    });
                });

            });
        });
    });

    mocha.it('HTTP/WS', function() {
        rpc.register_service(test_api, {
            get: req => REPLY
        }, {
            allow_missing_methods: true
        });
        let http_server;
        let http_client;
        let ws_client;
        return rpc.start_http_server({
                port: 0,
                ws: true,
                secure: false,
                logging: true
            })
            .then(http_server_arg => {
                http_server = http_server_arg;
                http_client = rpc.new_client({
                    address: 'http://127.0.0.1:' + http_server.address().port
                });
                ws_client = rpc.new_client({
                    address: 'ws://127.0.0.1:' + http_server.address().port
                });
            })
            .then(() => http_client.test.get(PARAMS))
            .then(() => ws_client.test.get(PARAMS))
            .then(() => http_server.close());
    });

    mocha.it('HTTPS/WSS', function() {
        rpc.register_service(test_api, {
            get: req => REPLY
        }, {
            allow_missing_methods: true
        });
        let https_server;
        let https_client;
        let wss_client;
        return rpc.start_http_server({
                port: 0,
                ws: true,
                secure: true,
                logging: true
            })
            .then(https_server_arg => {
                https_server = https_server_arg;
                https_client = rpc.new_client({
                    address: 'https://127.0.0.1:' + https_server.address().port
                });
                wss_client = rpc.new_client({
                    address: 'wss://127.0.0.1:' + https_server.address().port
                });
            })
            .then(() => https_client.test.get(PARAMS))
            .then(() => wss_client.test.get(PARAMS))
            .then(() => https_server.close());
    });

    mocha.it('TCP', function() {
        rpc.register_service(test_api, {
            get: req => REPLY
        }, {
            allow_missing_methods: true
        });
        let tcp_server;
        return rpc.register_tcp_transport(0)
            .then(tcp_server_arg => {
                tcp_server = tcp_server_arg;
                var client = rpc.new_client({
                    address: 'tcp://127.0.0.1:' + tcp_server.port
                });
                return client.test.get(PARAMS);
            })
            .finally(() => {
                if (tcp_server) tcp_server.close();
            });
    });

    mocha.it('TLS', function() {
        rpc.register_service(test_api, {
            get: req => REPLY
        }, {
            allow_missing_methods: true
        });
        let tls_server;
        return P.nfcall(pem.createCertificate, {
                days: 365 * 100,
                selfSigned: true
            })
            .then(cert => {
                return rpc.register_tcp_transport(0, {
                    key: cert.serviceKey,
                    cert: cert.certificate
                });
            })
            .then(tls_server_arg => {
                tls_server = tls_server_arg;
                var client = rpc.new_client({
                    address: 'tls://127.0.0.1:' + tls_server.port
                });
                return client.test.get(PARAMS);
            })
            .finally(() => {
                if (tls_server) tls_server.close();
            });
    });

    mocha.it('N2N DEFAULT', n2n_tester());
    mocha.it('N2N UDP', n2n_tester({
        udp_port: true,
        tcp_active: false,
        tcp_permanent_passive: false,
        tcp_transient_passive: false,
        tcp_simultaneous_open: false,
    }));
    mocha.it('N2N TCP', n2n_tester({
        tcp_active: true,
        tcp_permanent_passive: {
            min: 40400,
            max: 50500,
        },
        tcp_tls: false,
        udp_port: false,
    }));
    mocha.it('N2N TLS', n2n_tester({
        tcp_active: true,
        tcp_permanent_passive: {
            min: 40400,
            max: 50500,
        },
        tcp_tls: true,
        udp_port: false,
    }));

    function n2n_tester(n2n_config) {
        return function() {
            rpc.register_service(test_api, {
                get: req => REPLY
            }, {
                allow_missing_methods: true
            });
            let tcp_server;
            const ADDR = 'n2n://testrpc';
            let n2n_agent = rpc.register_n2n_transport(
                params => rpc.accept_n2n_signal(params)
            );
            n2n_agent.set_rpc_address(ADDR);
            n2n_agent.update_n2n_config(n2n_config);
            return rpc.register_tcp_transport(0)
                .then(tcp_server_arg => {
                    tcp_server = tcp_server_arg;
                    var client = rpc.new_client({
                        address: ADDR
                    });
                    return client.test.get(PARAMS);
                })
                .finally(() => {
                    if (tcp_server) tcp_server.close();
                    // reset the n2n config to close any open ports
                    n2n_agent.update_n2n_config({
                        tcp_permanent_passive: false
                    });
                });
        };
    }

});
