// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var express = require('express');
var request = require('request');
var utilitest = require('noobaa-util/utilitest');


describe('rest_api', function() {

    var rest_api = require('../util/rest_api');

    // init the test api
    var test_api = rest_api({
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
                        type: 'string',
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
            },
        }
    });

    // test data
    var PARAMS = {
        param1: '1',
        param2: 2,
        param3: true,
        param4: (new Date()).toISOString(),
        param5: [1, 2, 3],
    };
    var REPLY = {
        rest: ['IS', {
            fucking: 'aWeSoMe'
        }]
    };
    var ERROR_REPLY = {
        data: 'testing error',
        status: 404,
    };


    describe('define_api', function() {

        it('should detect api with collision paths', function() {
            assert.throws(function() {
                rest_api({
                    methods: {
                        a: {
                            method: 'GET',
                            path: '/'
                        },
                        b: {
                            method: 'GET',
                            path: '/'
                        }
                    }
                });
            });
        });

    });

    describe('Server', function() {

        it('should work on server inited properly', function() {
            // init the server and add extra propoerty and check that it works
            var router = new express.Router();
            var server = new test_api.Server({}, [], 'allow_missing_methods');
            server.install_routes(router);
        });

        it('should detect missing api func', function() {
            // check that missing functions are detected
            assert.throws(function() {
                var server = new test_api.Server();
            }, Error);
        });


        it('should work on mock router', function() {
            var router = {
                get: function() {},
                put: function() {},
                post: function() {},
                delete: function() {},
                use: function() {},
            };
            var server = new test_api.Server({}, [], 'allow_missing_methods');
            server.install_routes(router, '/');
        });

        it('should work on express app', function() {
            var app = express();
            var server = new test_api.Server({}, [], 'allow_missing_methods');
            server.install_routes(app, '/base/route/path/');
        });

    });


    describe('test_api round trip', function() {

        // create a test for every api function
        _.each(test_api.methods, function(func_info, func_name) {

            describe(func_name, function() {

                var reply_error = false;
                var server;
                var client;

                before(function() {
                    // init a server for the currently tested func.
                    // we use a dedicated server per func so that all the other funcs
                    // of the server return error in order to detect calling confusions.
                    var methods = {};
                    methods[func_name] = function(req) {
                        // console.log('TEST SERVER REQUEST');
                        _.each(PARAMS, function(param, name) {
                            assert.deepEqual(param, req.rest_params[name]);
                        });
                        if (reply_error) {
                            return Q.reject(ERROR_REPLY);
                        } else {
                            return Q.resolve(REPLY);
                        }
                    };
                    server = new test_api.Server(methods, [], 'allow_missing_methods');
                    server.install_routes(utilitest.router);

                    client = new test_api.Client({
                        port: utilitest.http_port(),
                    });
                });

                after(function() {
                    // disable the server to bypass its routes,
                    // this allows us to create a separate test for every function,
                    // since the express middlewares cannot be removed.
                    server.disable_routes();
                });

                it('should call and get reply', function(done) {
                    reply_error = false;
                    client[func_name](PARAMS).then(function(res) {
                        assert.deepEqual(res, REPLY);
                    }, function(err) {
                        console.log('UNEXPECTED ERROR', err, err.stack);
                        throw 'UNEXPECTED ERROR';
                    }).nodeify(done);
                });

                it('should call and get error', function(done) {
                    reply_error = true;
                    client[func_name](PARAMS).then(function(res) {
                        console.log('UNEXPECTED REPLY', res);
                        throw 'UNEXPECTED REPLY';
                    }, function(err) {
                        assert.deepEqual(err, ERROR_REPLY);
                    }).nodeify(done);
                });

                it('should return doc', function(done) {
                    var doc_url = 'http://localhost:' + utilitest.http_port() +
                        '/doc/api/test_api/' + func_name;
                    request(doc_url, function(error, response, body) {
                        assert(!error);
                        assert.strictEqual(response.statusCode, 200);
                        assert.strictEqual(body, test_api.methods[func_name].doc);
                        done();
                    });
                });

            });
        });
    });

});
