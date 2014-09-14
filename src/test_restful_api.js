// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('underscore');
var Q = require('q');
var assert = require('assert');
var express = require('express');
var request = require('request');
var utilitest = require('noobaa-util/utilitest');


describe('restful_api', function() {

    var restful_api = require('./restful_api');

    var test_params_info = {
        param1: {
            type: String,
            required: true,
        },
        param2: {
            type: Number,
            required: true,
        },
        param3: {
            type: Boolean,
            required: true,
        },
        param4: {
            type: Date,
            required: true,
        },
        param5: {
            type: Array,
            required: false,
        },
    };
    var test_reply_info = {
        rest: {
            type: Array,
            required: true,
        }
    };
    var PARAMS = {
        param1: '1',
        param2: 2,
        param3: true,
        param4: new Date(),
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
    var test_api = restful_api.define_api({
        name: 'Test',
        methods: {
            get: {
                method: 'GET',
                path: '/:param1/and/also/:param2',
                params: test_params_info,
                reply: test_reply_info,
                doc: 'get doc',
            },
            post: {
                method: 'POST',
                path: '/:param1/and/also/:param2',
                params: test_params_info,
                reply: test_reply_info,
                doc: 'post doc',
            },
            put: {
                method: 'PUT',
                path: '/:param1/and/also/:param3',
                params: test_params_info,
                reply: test_reply_info,
                doc: 'put doc',
            },
            delete: {
                method: 'DELETE',
                path: '/all/:param2',
                params: test_params_info,
                reply: test_reply_info,
                doc: 'del doc',
            },
        }
    });


    describe('define_api', function() {

        it('should detect api with collision paths', function() {
            assert.throws(function() {
                restful_api.define_api({
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
                            assert.deepEqual(param, req.restful_params[name]);
                        });
                        if (reply_error) {
                            return Q.reject(ERROR_REPLY);
                        } else {
                            return Q.when(REPLY);
                        }
                    };
                    server = new test_api.Server(methods, [], 'allow_missing_methods');
                    server.install_routes(utilitest.router, '/test_restful_api');
                    // server.set_logging();

                    client = new test_api.Client({
                        port: utilitest.http_port(),
                        path: '/test_restful_api',
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
                        assert.deepEqual(res.data, REPLY);
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
                        assert.deepEqual(err.data, ERROR_REPLY.data);
                    }).nodeify(done);
                });

                it('should return doc', function(done) {
                    var doc_url = 'http://localhost:' + utilitest.http_port() +
                        '/test_restful_api/doc/Test/' + func_name;
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
