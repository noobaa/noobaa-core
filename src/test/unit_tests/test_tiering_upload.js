/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup({ pools_to_create: coretest.POOL_LIST });

const _ = require('lodash');
const util = require('util');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');

// const P = require('../../util/promise');
const config = require('../../../config.js');
const ObjectIO = require('../../sdk/object_io');
const SliceReader = require('../../util/slice_reader');
const system_store = require('../../server/system_services/system_store').get_instance();
const node_allocator = require('../../server/node_services/node_allocator');

const { rpc_client } = coretest;
const object_io = new ObjectIO();
object_io.set_verification_mode();

const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));
const core_agent_control = {}; // TODO require('./core_agent_control');
const node_server = require('../../server/node_services/node_server');

mocha.describe('tiering upload', function() {

    const BUCKET = 'tiering-upload-bucket';
    const TIERING_POLICY = 'tiering-upload-policy';
    const TIER0 = 'tiering-upload-tier0';
    const TIER1 = 'tiering-upload-tier1';
    const POOL0 = coretest.pools.find(pool => pool.host_count === 1).name;
    const POOL1 = coretest.pools.find(pool => pool.host_count === 10).name;
    const KEY = 'key';
    let key_counter = 1;
    let agent0;

    const agentCtlConfig = core_agent_control.show_ctl();

    mocha.before(async function() {
        this.timeout(600000); // eslint-disable-line no-invalid-this
        const nodes_names = Object.keys(agentCtlConfig.allocated_agents);
        const node0 = nodes_names[0];
        await rpc_client.pool.create_nodes_pool({
            name: POOL0,
            nodes: [{ name: node0 }],
        });
        let migrating = true;
        while (migrating) {
            await node_server.sync_monitor_to_store();
            const node_info = await rpc_client.node.read_node({ name: node0 });
            migrating = Boolean(node_info.migrating_to_pool);
        }
        agent0 = agentCtlConfig.allocated_agents[node0].agent;
        const tier0_free_space = 300 * 1024 * 1024;
        agent0.block_store._usage.size = agent0.block_store.usage_limit - tier0_free_space;
        await node_server.sync_monitor_storage_info();

        // await first_agent.get_agent_info_and_update_masters({
        //     addresses: 'localhost'
        // });
        await rpc_client.tier.create_tier({
            name: TIER0,
            attached_pools: [POOL0],
            data_placement: 'SPREAD',
            chunk_coder_config: { replicas: 1 }
        });
        await rpc_client.tier.create_tier({
            name: TIER1,
            attached_pools: [POOL1],
            data_placement: 'SPREAD',
            chunk_coder_config: { replicas: 1 }
        });
        await rpc_client.tiering_policy.create_policy({
            name: TIERING_POLICY,
            tiers: [{
                order: 0,
                tier: TIER0,
                disabled: false
            }, {
                order: 1,
                tier: TIER1,
                disabled: false
            }]
        });
        await rpc_client.bucket.create_bucket({
            name: BUCKET,
            tiering: TIERING_POLICY,
        });
    });

    mocha.after(async function() {
        // TODO fix me to restore the node to original state for other tests.
        // agent0.block_store._used = 0;
        // await rpc_client.pool.assign_nodes_to_pool({
        //     name: POOL1,
        //     nodes: [{ name: agent0.node_name }],
        // });
    });


    mocha.it('filling up to full tier', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this
        const tier0_storage = await get_current_storage(TIER0);
        const upload_size = tier0_storage.free;
        const up = await upload_and_get_storage(upload_size);
        const diff_percent = Math.abs((up.tier0_change / upload_size) - 1);

        coretest.log('test_tiering_upload:', up, 'diff_percent', diff_percent);
        if (diff_percent > 0.05) {
            assert.fail(`Expected diff_percent > 0.05 but got ${diff_percent}`);
        }
        await rpc_client.object.delete_object({ bucket: BUCKET, key: up.key });
    });

    mocha.it('filling more than full tier threshold - checking everything still works', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this
        const tier0_storage = await get_current_storage(TIER0);
        const upload_size = tier0_storage.free + config.ENOUGH_ROOM_IN_TIER_THRESHOLD;
        const up = await upload_and_get_storage(upload_size);
        const expected_tier1_change = upload_size - up.tier0_before.free;
        const tier1_skew = Math.abs(up.tier1_change - expected_tier1_change);
        const tier1_skew_percent = Math.abs((up.tier1_change / expected_tier1_change) - 1);

        coretest.log('test_tiering_upload:', up,
            'expected_tier1_change', expected_tier1_change,
            'tier1_skew', tier1_skew,
            'tier1_skew_percent', tier1_skew_percent
        );
        if (tier1_skew_percent > 0.05 && tier1_skew > 100 * 1024 * 1024) {
            assert.fail(`Expected tier1 change to be ${expected_tier1_change} but got ${up.tier1_change}`);
        }
        await rpc_client.object.delete_object({ bucket: BUCKET, key: up.key });
    });

    mocha.it('write 3 files the last should push the first to second tier', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this

        // setting upload size to 1/2 of the tier0 space, and upload 3! files to push into tier1.
        const tier0_storage = await get_current_storage(TIER0);
        const upload_size = tier0_storage.free / 2;
        const up1 = await upload_and_get_storage(upload_size);
        verify_skew(up1.tier0_change, upload_size);
        const up2 = await upload_and_get_storage(upload_size);
        verify_skew(up2.tier0_change, upload_size);
        const up3 = await upload_and_get_storage(upload_size);
        verify_skew(up3.tier0_change, up3.tier0_free);
        verify_skew(up3.tier1_change, upload_size - up3.tier0_free);

        await rpc_client.object.delete_object({ bucket: BUCKET, key: up1.key });
        await rpc_client.object.delete_object({ bucket: BUCKET, key: up2.key });
        await rpc_client.object.delete_object({ bucket: BUCKET, key: up3.key });
    });

    // mocha.it('test999 - filling more than tiering threshold - checking files starting to tier', async function() {
    //     this.timeout(900000); // eslint-disable-line no-invalid-this
    //     const upload_size = 150 * 1024 * 1024;
    //     const storage1 = await get_current_storage(TIER1);
    //     const key = await upload_file(upload_size);
    //     const storage2 = await get_current_storage(TIER1);
    //     const used_delta = storage1.free - storage2.free;
    //     const diff_percent = Math.abs((used_delta / (upload_size - (100 * 1024 * 1024))) - 1);
    //     coretest.log('test_tiering_upload: test2',
    //         'used_delta', used_delta,
    //         'diff_percent', diff_percent);
    //     if (diff_percent > 0.05) {
    //         assert.fail(`Expected used_delta=${used_delta} to be approx upload_size=${upload_size} - 100MB`);
    //     }
    //     await rpc_client.object.delete_object({ bucket: BUCKET, key });
    // });

    mocha.it('filling in parallel', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this
        const tier0_before = await get_current_storage(TIER0);
        const tier1_before = await get_current_storage(TIER1);
        const upload_size = tier0_before.free + config.ENOUGH_ROOM_IN_TIER_THRESHOLD;
        const upload_count = 10;
        const upload_file_size = Math.ceil(upload_size / upload_count);
        const keys = await Promise.all(_.times(upload_count, () => upload_file(upload_file_size)));
        // const tier0_after = await get_current_storage(TIER0);
        const tier1_after = await get_current_storage(TIER1);
        const tier1_change = tier1_before.free - tier1_after.free;
        const expected_tier1_change = upload_size - tier0_before.free;
        const tier1_skew = Math.abs(tier1_change - expected_tier1_change);
        const tier1_skew_percent = Math.abs((tier1_change / expected_tier1_change) - 1);

        coretest.log('test_tiering_upload:',
            'expected_tier1_change', expected_tier1_change,
            'tier1_change', tier1_change,
            'tier1_skew', tier1_skew,
            'tier1_skew_percent', tier1_skew_percent
        );
        if (tier1_skew_percent > 0.05 && tier1_skew > 100 * 1024 * 1024) {
            assert.fail(`Expected tier1 change to be ${expected_tier1_change} but got ${tier1_change}`);
        }
        await rpc_client.object.delete_multiple_objects({ bucket: BUCKET, objects: keys.map(key => ({ key })) });
    });

    function verify_skew(actual_change, expected_change) {
        const tier_skew = Math.abs(actual_change - expected_change);
        const tier_skew_percent = Math.abs((actual_change / expected_change) - 1);
        if (tier_skew_percent > 0.05 && tier_skew > 100 * 1024 * 1024) {
            assert.fail(`Expected tier change to be ${expected_change} but got ${actual_change}`);
        }
    }

    async function upload_file(size) {
        const data1 = generator.update(Buffer.alloc(size));
        const key = `${KEY}-${key_counter}`;
        key_counter += 1;
        const params = {
            client: rpc_client,
            bucket: BUCKET,
            key,
            size,
            content_type: 'application/octet-stream',
            source_stream: new SliceReader(data1),
        };
        await object_io.upload_object(params);
        return key;
    }

    async function upload_and_get_storage(upload_size) {
        const tier0_before = await get_current_storage(TIER0);
        const tier1_before = await get_current_storage(TIER1);
        const key = await upload_file(upload_size);
        const tier0_after = await get_current_storage(TIER0);
        const tier1_after = await get_current_storage(TIER1);

        const tier0_change = tier0_before.free - tier0_after.free;
        const tier1_change = tier1_before.free - tier1_after.free;

        coretest.log('upload_and_get_storage:',
            'upload_size', upload_size,
            'key', key,
            'tier0_change', tier0_change,
            'tier1_change', tier1_change
        );

        return {
            key,
            tier0_before,
            tier1_before,
            tier0_after,
            tier1_after,
            tier0_change,
            tier1_change,
        };
    }

    async function get_current_storage(tier) {
        const system = system_store.data.systems_by_name[coretest.SYSTEM];
        const tiering = system.tiering_policies_by_name[TIERING_POLICY];
        const tier0 = system.tiers_by_name[tier];

        await node_allocator.refresh_tiering_alloc(tiering, 'force');
        const tiering_status = node_allocator.get_tiering_status(tiering);

        const tier_status = tiering_status[tier0._id.toHexString()];
        const storage = tier_status.mirrors_storage[0];
        // const { storage } = await rpc_client.tier.read_tier({ name: TIER0 });
        coretest.log('GGG get_current_storage:', util.inspect(storage, { depth: null }));
        return storage;
    }
});
