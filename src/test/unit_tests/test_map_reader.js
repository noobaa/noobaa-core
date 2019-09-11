/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: [coretest.POOL_LIST[0]] });

// const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
// const assert = require('assert');
const mongodb = require('mongodb');

// const P = require('../../util/promise');
// const MDStore = require('../../server/object_services/md_store').MDStore;
// const map_writer = require('../../server/object_services/map_writer');
const map_reader = require('../../server/object_services/map_reader');
// const system_store = require('../../server/system_services/system_store').get_instance();

coretest.describe_mapper_test_case({
    name: 'map_reader',
    bucket_name_prefix: 'test-map-reader',
}, ({
    test_name,
    bucket_name,
    data_placement,
    num_pools,
    replicas,
    data_frags,
    parity_frags,
    total_frags,
    total_blocks,
    total_replicas,
    chunk_coder_config,
}) => {

    // TODO we need to create more nodes and pools to support all MAPPER_TEST_CASES
    if (data_placement !== 'SPREAD' || num_pools !== 1 || total_blocks > 10) return;

    // TODO test_map_reader

    mocha.it('read_object_mapping', function() {
        const obj = { size: 100, _id: new mongodb.ObjectId() };
        const start = 0;
        const end = 100;
        return map_reader.read_object_mapping(obj, start, end);
    });

    mocha.it('read_object_mapping_admin', function() {
        const obj = { size: 100, _id: new mongodb.ObjectId() };
        const skip = 0;
        const limit = 100;
        return map_reader.read_object_mapping_admin(obj, skip, limit);
    });

    mocha.it('read_node_mapping', function() {
        const node_ids = [];
        const skip = 0;
        const limit = 0;
        return map_reader.read_node_mapping(node_ids, skip, limit);
    });

});
