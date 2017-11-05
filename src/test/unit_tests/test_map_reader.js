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
const map_reader = require('../../server/object_services/map_reader');
// const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('map_reader', function() {

    const { rpc_client } = coretest;
    const BKT = 'test-map-reader';
    const chunk_coder_config = {};

    mocha.before(function() {
        return P.resolve()
            .then(() => rpc_client.bucket.create_bucket({
                name: BKT,
                chunk_coder_config,
            }));
    });

    // TODO test_map_reader

    mocha.it('read_object_mappings', function() {
        const obj = { size: 100 };
        const start = 0;
        const end = 100;
        const skip = 0;
        const limit = 0;
        const adminfo = true;
        return map_reader.read_object_mappings(obj, start, end, skip, limit, adminfo);
    });

    mocha.it('read_node_mappings', function() {
        const node_ids = [];
        const skip = 0;
        const limit = 0;
        return map_reader.read_node_mappings(node_ids, skip, limit);
    });

});
