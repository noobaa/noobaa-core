/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
const mocha = require('mocha');
// const assert = require('assert');
const NodesStore = require('../../server/node_services/nodes_store').NodesStore;

mocha.describe('nodes_store', function() {

    const nodes_store = new NodesStore(`_test_nodes_store_${Date.now().toString(36)}`);

    mocha.it('find_nodes()', function() {
        return nodes_store.find_nodes();
    });

    // TODO continue test_nodes_store ...

});
