'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
// var assert = require('assert');
var coretest = require('./coretest');

mocha.describe('agent', function() {

    var client = coretest.new_test_client();

    const SYS = 'test-agent-system';
    const EMAIL = SYS + '@coretest.coretest';
    const PASSWORD = 'tululu';
    const ACCESS_KEYS = {
        access_key: 'ydaydayda',
        secret_key: 'blablabla'
    };

    mocha.it('should run agents', function() {
        this.timeout(20000);
        return P.resolve()
            .then(() => client.account.create_account({
                name: SYS,
                email: EMAIL,
                password: PASSWORD,
                access_keys: ACCESS_KEYS
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => coretest.init_test_nodes(client, SYS, 5))
            .then(() => coretest.clear_test_nodes());
    });

});
