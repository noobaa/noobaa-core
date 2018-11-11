/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const coretest = require('./coretest');
coretest.setup();

// const _ = require('lodash');
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
const core_agent_control = require('./core_agent_control');
const node_server = require('../../server/node_services/node_server');

mocha.describe('tiering upload', function() {

    const BUCKET = 'tiering-upload-bucket';
    const TIERING_POLICY = 'tiering-upload-policy';
    const TIER0 = 'tiering-upload-tier0';
    const TIER1 = 'tiering-upload-tier1';
    const POOL0 = 'tiering-upload-pool0';
    const POOL1 = config.NEW_SYSTEM_POOL_NAME;
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
        const space = 300 * 1024 * 1024;
        agent0.block_store._usage.size = agent0.block_store._total_mem_storage - space;
        await node_server.sync_monitor_to_store();

        // await first_agent.get_agent_info_and_update_masters({
        //     addresses: '127.0.0.1'
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


    mocha.it('test1 - filling up to full tier', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this
        const upload_size = 100 * 1024 * 1024;
        const storage1 = await get_current_storage(TIER0);
        const key = await upload_file(upload_size);
        const storage2 = await get_current_storage(TIER0);
        const used_delta = storage1.free - storage2.free;
        const diff_percent = Math.abs((used_delta / upload_size) - 1);
        console.log('test_tiering_upload: test1',
            'used_delta', used_delta,
            'diff_percent', diff_percent);
        if (diff_percent > 0.05) {
            assert.fail(`Expected used_delta=${used_delta} to be approx upload_size=${upload_size}`);
        }
        await rpc_client.object.delete_object({ bucket: BUCKET, key });
    });

    // mocha.it('test2 - filling more than tiering threshold - checking files starting to tier', async function() {
    //     this.timeout(900000); // eslint-disable-line no-invalid-this
    //     const upload_size = 150 * 1024 * 1024;
    //     const storage1 = await get_current_storage(TIER1);
    //     const key = await upload_file(upload_size);
    //     const storage2 = await get_current_storage(TIER1);
    //     const used_delta = storage1.free - storage2.free;
    //     const diff_percent = Math.abs((used_delta / (upload_size - (100 * 1024 * 1024))) - 1);
    //     console.log('test_tiering_upload: test2',
    //         'used_delta', used_delta,
    //         'diff_percent', diff_percent);
    //     if (diff_percent > 0.05) {
    //         assert.fail(`Expected used_delta=${used_delta} to be approx upload_size=${upload_size} - 100MB`);
    //     }
    //     await rpc_client.object.delete_object({ bucket: BUCKET, key });
    // });

    mocha.it.only('test3 - filling more than full tier threshold - checking everything still works', async function() {
        this.timeout(900000); // eslint-disable-line no-invalid-this
        const upload_size = 500 * 1024 * 1024;
        const storage1 = await get_current_storage(TIER1);
        const key = await upload_file(upload_size);
        const storage2 = await get_current_storage(TIER1);
        const used_delta = storage1.free - storage2.free;
        const diff_percent = Math.abs((used_delta / (upload_size - (200 * 1024 * 1024))) - 1);
        console.log('test_tiering_upload: test3',
            'used_delta', used_delta,
            'diff_percent', diff_percent);
        if (diff_percent > 0.05) {
            assert.fail(`Expected used_delta=${used_delta} to be approx upload_size=${upload_size} - 200MB`);
        }
        await rpc_client.object.delete_object({ bucket: BUCKET, key });
    });


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

    async function get_current_storage(tier) {
        await node_server.sync_monitor_to_store();

        const system = system_store.data.systems_by_name[coretest.SYSTEM];
        const tiering = system.tiering_policies_by_name[TIERING_POLICY];
        const tier0 = system.tiers_by_name[tier];

        await node_allocator.refresh_tiering_alloc(tiering, 'force');
        const tiering_status = node_allocator.get_tiering_status(tiering);

        const tier_status = tiering_status[tier0._id];
        const storage = tier_status.mirrors_storage[0];
        // const { storage } = await rpc_client.tier.read_tier({ name: TIER0 });
        console.log('GGG get_current_storage:', util.inspect(storage, { depth: null }));
        return storage;
    }
});
