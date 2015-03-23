// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var express = require('express');
var request = require('request');
var coretest = require('./coretest');
var RPC = require('../rpc/rpc');
var rpc_http = require('../rpc/rpc_http');


describe('RPC HTTP', function() {

    // init the test api
    var test_api = {
        name: 'test_api',
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
                        format: 'date',
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
                path: '/:param1/and/also/:param2',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'get doc',
                auth: false,
            },
            post: {
                method: 'POST',
                path: '/:param1/and/also/:param2',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'post doc',
                auth: false,
            },
            put: {
                method: 'PUT',
                path: '/:param1/and/also/:param3',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
                },
                doc: 'put doc',
                auth: false,
            },
            delete: {
                method: 'DELETE',
                path: '/all/:param2',
                params: {
                    $ref: '/test_api/definitions/params_schema'
                },
                reply: {
                    $ref: '/test_api/definitions/reply_schema'
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
    var ERROR_REPLY = 'testing error';
    var ERROR_STATUS = 473;


    describe('register_api', function() {

        it('should detect api with bad method', function() {
            assert.throws(function() {
                var rpc = new RPC();
                rpc.register_api({
                    methods: {
                        a: {
                            method: 'POSTER',
                            path: '/'
                        },
                    }
                });
            });
        });

    });

    describe('register_service', function() {

        it('should work on empty server with allow_missing_methods', function() {
            var rpc = new RPC();
            rpc.register_api(test_api);
            rpc.register_service({}, 'test_api', '', {
                allow_missing_methods: true
            });
        });

        it('should detect missing api func', function() {
            // check that missing functions are detected
            var rpc = new RPC();
            rpc.register_api(test_api);
            assert.throws(function() {
                rpc.register_service({}, 'test_api', '');
            }, Error);
        });

        it('should throw on duplicate service', function() {
            var rpc = new RPC();
            rpc.register_api(test_api);
            rpc.register_service({}, 'test_api', 17, {
                allow_missing_methods: true
            });
            assert.throws(function() {
                rpc.register_service({}, 'test_api', 17, {
                    allow_missing_methods: true
                });
            }, Error);
        });

        it('should work on mock server', function() {
            var rpc = new RPC();
            rpc.register_api(test_api);
            var server = {
                get: function() {},
                put: function() {},
                post: function() {},
                delete: function() {},
                use: function() {},
            };
            rpc.register_service(server, 'test_api', '');
        });

    });


    describe('test_api round trip', function() {

        // create a test for every api function
        _.each(test_api.methods, function(method_api, method_name) {

            var rpc = new RPC();
            rpc.register_api(test_api);

            describe(method_name, function() {

                var reply_error = false;
                var server;
                var client;

                before(function() {
                    // init a server for the currently tested func.
                    // we use a dedicated server per func so that all the other funcs
                    // of the server return error in order to detect calling confusions.
                    var methods = {};
                    methods[method_name] = function(req) {
                        // console.log('TEST SERVER REQUEST');
                        _.each(PARAMS, function(param, name) {
                            assert.deepEqual(param, req.rest_params[name]);
                        });
                        if (reply_error) {
                            throw req.rest_error(ERROR_STATUS, ERROR_REPLY);
                        } else {
                            return Q.resolve(REPLY);
                        }
                    };
                    rpc.register_service(methods, 'test_api', '', {
                        allow_missing_methods: true
                    });
                    client = rpc.create_client('test_api');
                });

                it('should call and get reply', function(done) {
                    reply_error = false;
                    client[method_name](PARAMS).then(function(res) {
                        assert.deepEqual(res, REPLY);
                    }, function(err) {
                        console.log('UNEXPECTED ERROR', err, err.stack);
                        throw 'UNEXPECTED ERROR';
                    }).nodeify(done);
                });

                it('should call and get error', function(done) {
                    reply_error = true;
                    client[method_name](PARAMS).then(function(res) {
                        console.log('UNEXPECTED REPLY', res);
                        throw 'UNEXPECTED REPLY';
                    }, function(err) {
                        assert.deepEqual(err.statusCode, ERROR_STATUS);
                        assert.deepEqual(err.data, ERROR_REPLY);
                    }).nodeify(done);
                });

                it.skip('should return doc', function(done) {
                    var doc_url = 'http://localhost:' + coretest.http_port() +
                        '/doc/api/test_api/' + method_name;
                    request(doc_url, function(error, response, body) {
                        assert(!error);
                        assert.strictEqual(response.statusCode, 200);
                        assert.strictEqual(body, test_api.methods[method_name].doc);
                        done();
                    });
                });

            });
        });
    });

});
