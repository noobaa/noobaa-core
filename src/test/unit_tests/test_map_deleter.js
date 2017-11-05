/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
const mocha = require('mocha');
// const assert = require('assert');
// const mongodb = require('mongodb');

const P = require('../../util/promise');
// const dbg = require('../../util/debug_module')(__filename);
// const config = require('../../../config.js');
// const mapper = require('../../server/object_services/mapper');
const map_deleter = require('../../server/object_services/map_deleter');
// const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('map_deleter', function() {

    const { rpc_client } = coretest;
    const BKT = 'test-map-deleter';
    const chunk_coder_config = {};

    mocha.before(function() {
        return P.resolve()
            .then(() => rpc_client.bucket.create_bucket({
                name: BKT,
                chunk_coder_config,
            }));
    });

    // TODO test_map_deleter

    mocha.it('delete_object', function() {
        return map_deleter.delete_object();
    });

    mocha.it('delete_chunks', function() {
        return map_deleter.delete_chunks();
    });

    mocha.it('delete_multiple_objects', function() {
        return map_deleter.delete_multiple_objects();
    });

    mocha.it('delete_object_mappings', function() {
        return map_deleter.delete_object_mappings();
    });

    mocha.it('delete_blocks_from_nodes', function() {
        return map_deleter.delete_blocks_from_nodes();
    });

});
