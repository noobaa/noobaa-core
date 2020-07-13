/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
// const assert = require('assert');
// const mongodb = require('mongodb');

// const P = require('../../util/promise');
// const MDStore = require('../../server/object_services/md_store').MDStore;
// const map_writer = require('../../server/object_services/map_writer');
const map_deleter = require('../../server/object_services/map_deleter');
// const system_store = require('../../server/system_services/system_store').get_instance();

coretest.describe_mapper_test_case({
    name: 'map_deleter',
    bucket_name_prefix: 'test-map-deleter',
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

    // TODO test_map_deleter

    mocha.it('delete_chunks', function() {
        return map_deleter.delete_chunks();
    });

    mocha.it('delete_object_mappings', function() {
        return map_deleter.delete_object_mappings();
    });

    mocha.it('delete_blocks_from_nodes', function() {
        return map_deleter.delete_blocks_from_nodes();
    });

    mocha.it('delete_parts_by_chunks', function() {
        return map_deleter.delete_parts_by_chunks();
    });
});
