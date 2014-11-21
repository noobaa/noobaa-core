// make jshint ignore mocha globals
/* global describe, it, before, after, beforeEach, afterEach */
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var coretest = require('./coretest');

describe('system_api', function() {

    var account_client = coretest.account_client;

    var EMAIL = 'bla@bla.blabla';
    var PASSWORD = 'supersecret';

    after(function(done) {
        Q.fcall(
            function() {
                // login back to default account for other tests to run well
                return coretest.login_default_account();
            }
        ).nodeify(done);
    });

    describe('account full flow', function() {

        it('works', function(done) {
            Q.fcall(function() {
                return account_client.create_account({
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return account_client.login_account({
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return account_client.read_account().then(function(res) {
                    assert.strictEqual(res.email, EMAIL);
                });
            }).then(function() {
                return account_client.logout_account();
            }).then(function() {
                return account_client.login_account({
                    email: EMAIL,
                    password: PASSWORD,
                });
            }).then(function() {
                return account_client.update_account({
                    email: EMAIL + '123',
                });
            }).then(function() {
                return account_client.read_account().then(function(res) {
                    assert.strictEqual(res.email, EMAIL + '123');
                });
            }).then(function() {
                return account_client.delete_account();
            }).nodeify(done);
        });

    });

});
