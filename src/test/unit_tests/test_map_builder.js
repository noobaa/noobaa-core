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
const map_builder = require('../../server/object_services/map_builder');
// const system_store = require('../../server/system_services/system_store').get_instance();

mocha.describe('map_builder', function() {

    const { rpc_client } = coretest;
    const BKT = 'test-map-builder';
    const chunk_coder_config = {};

    mocha.before(function() {
        return P.resolve()
            .then(() => rpc_client.bucket.create_bucket({
                name: BKT,
                chunk_coder_config,
            }));
    });

    // TODO test_map_builder

    mocha.it('MapBuilder', function() {
        const chunk_ids = [];
        return new map_builder.MapBuilder(chunk_ids).run();
    });

});
