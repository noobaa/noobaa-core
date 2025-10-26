/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const Speedometer = require('../../util/speedometer');
const BlockStoreFs = require('./block_store_fs').BlockStoreFs;
const argv = require('minimist')(process.argv);
const P = require('../../util/promise');
const _ = require('lodash');
const concur = argv.concur || 1;


const speedometer = new Speedometer('Block Store Speed');

main();

async function main() {
    speedometer.clear_interval();
    speedometer.report();
    const block_store_options = {
        node_name: 'test-node',
        root_path: '/noobaa_storage/amark-pvpool-lloyds-noobaa-pod-9729b59d-noobaa_storage-21382b12/'
    };
    const block_store = new BlockStoreFs(block_store_options);
    let block_ids = JSON.parse(fs.readFileSync('/tmp/blocks.json').toString());
    // shuffle block_ids
    block_ids = _.shuffle(block_ids);
    await P.map_with_concurrency(concur, block_ids, async block_id => {
        if (!block_id) return;
        const start = Date.now();
        let res = null;
        try {
            res = await block_store._read_block({
                id: block_id,
            });
        } catch (error) {
            console.warn('_read_block failed:', error, block_id);
            return;
        }
        const took = Date.now() - start;
        speedometer.add_op(took);
        speedometer.update(res.data.length);
    });
}
