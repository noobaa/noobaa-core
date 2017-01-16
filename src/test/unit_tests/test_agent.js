/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// var _ = require('lodash');
var P = require('../../util/promise');
var mocha = require('mocha');
// var assert = require('assert');

mocha.describe('agent', function() {

    var client = coretest.new_test_client();

    const SYS = 'test-agent-system';
    const EMAIL = SYS + '@coretest.coretest';
    const PASSWORD = 'tululu';

    mocha.it('should run agents', function() {
        const self = this; // eslint-disable-line no-invalid-this
        self.timeout(20000);

        return P.resolve()
            .then(() => client.system.create_system({
                activation_code: '1111',
                name: SYS,
                email: EMAIL,
                password: PASSWORD
            }))
            .then(res => {
                client.options.auth_token = res.token;
            })
            .then(() => coretest.init_test_nodes(client, SYS, 5))
            .delay(2000)
            .then(() => coretest.clear_test_nodes())
            .catch((err) => {
                console.log('Failure during testing agent:' + err, err.stack);
            });
    });

});
