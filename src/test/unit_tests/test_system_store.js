/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
const mocha = require('mocha');
// const assert = require('assert');
const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('system_store', function() {

    mocha.it('load()', function() {
        return system_store.load();
    });

    // TODO continue test_system_store ...

});
