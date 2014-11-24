// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');
var account_api = require('../api/account_api');

describe('account', function() {

    var account_client;
    var NAME = 'bla bla';
    var EMAIL = 'bla@bla.blabla';
    var PASSWORD = 'shhhhhhh';

    beforeEach(function() {
        // create my own account client on each test
        // to prevent contaminating the headers
        account_client = new account_api.Client({
            port: coretest.http_port()
        });
    });

    describe('account full flow', function() {

        it('works', function(done) {
            Q.fcall(function() {
                return account_client.create_account({
                    name: NAME,
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return account_client.create_account({
                    name: NAME,
                    email: EMAIL,
                    password: PASSWORD,
                }).then(
                    function(res) {
                        throw new Error('expected error: account already exists');
                    },
                    function(err) {
                        assert.strictEqual(err.data, 'account already exists');
                    }
                );
            }).then(function() {
                return account_client.authenticate({
                    email: EMAIL,
                    password: PASSWORD + '!',
                }).then(
                    function(res) {
                        throw new Error('expected error: incorrect email and password');
                    },
                    function(err) {
                        assert.strictEqual(err.data, 'incorrect email and password');
                    }
                );
            }).then(function() {
                return account_client.authenticate({
                    email: EMAIL,
                    password: PASSWORD,
                }).then(function(res) {
                    console.log('AUTH TOKEN', res.token);
                    account_client.set_authorization(res.token);
                });
            }).then(function() {
                return account_client.read_account().then(function(res) {
                    assert.strictEqual(res.email, EMAIL);
                });
            }).then(function() {
                return account_client.update_account({
                    name: NAME + ' blahhh',
                    email: EMAIL + '123',
                });
            }).then(function() {
                return account_client.read_account().then(function(res) {
                    assert.strictEqual(res.name, NAME + ' blahhh');
                    assert.strictEqual(res.email, EMAIL + '123');
                });
            }).then(function() {
                return account_client.delete_account();
            }).then(function() {
                account_client.set_authorization(null);
            }).nodeify(done);
        });

    });

});
