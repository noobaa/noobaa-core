/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
// const P = require('../../util/promise');
const mocha = require('mocha');
// const assert = require('assert');

mocha.describe('agent', function() {

    mocha.it.skip('should run agents', function() {
        this.timeout(20000); // eslint-disable-line no-invalid-this

        // TODO test_agent is empty...

    });

});
