/* Copyright (C) 2016 NooBaa */
'use strict';

// setup coretest first to prepare the env
const { setup, rpc_client, POOL_LIST } = require('../../utils/coretest/coretest');
setup({ pools_to_create: [POOL_LIST[1]] });

// const _ = require('lodash');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const config = require('../../../../config');
const SliceReader = require('../../../util/slice_reader');
const ObjectIO = require('../../../sdk/object_io');
const P = require('../../../util/promise');
const { TieringTTLWorker } = require('../../../server/bg_services/tier_ttl_worker');
const { MDStore } = require('../../../server/object_services/md_store');
const { ChunkDB } = require('../../../server/object_services/map_db_types');

const object_io = new ObjectIO();
object_io.set_verification_mode();

const seed = crypto.randomBytes(16);
const generator = crypto.createCipheriv('aes-128-gcm', seed, Buffer.alloc(12));

async function upload_object({
    bucket,
    key,
    size = 1024,
}) {
    const data = generator.update(Buffer.alloc(size));
    const params = {
        client: rpc_client,
        bucket,
        key,
        size,
        content_type: 'application/octet-stream',
        source_stream: new SliceReader(data),
    };
    await object_io.upload_object(params);
    const chunk_ids = await MDStore.instance().find_parts_chunk_ids({
        _id: MDStore.instance().make_md_id(params.obj_id)
    });

    const obj = {
        bucket,
        key,
        size,
        obj_id: params.obj_id,
        data,
        chunk_ids,
        chunks: undefined,
    };

    await load_chunks(obj);
    return obj;
}

async function load_chunks(obj) {
    const chunks = await MDStore.instance().find_chunks_by_ids(obj.chunk_ids);
    await MDStore.instance().load_blocks_for_chunks(chunks);
    obj.chunks = chunks.map(chunk => new ChunkDB(chunk));
}

mocha.describe('tiering_ttl_worker', function() {
    const BUCKET_NAME = 'tiering-ttl-worker-test-bucket';
    const default_ttl_ms = config.TIERING_TTL_MS;
    const ttl_worker = new TieringTTLWorker({ name: 'test_tiering_ttl_worker', client: rpc_client });

    mocha.before(async function() {
        // Enable tiering auto config - test is not specific to TMFS
        // but enabling these configs will enable the tiering auto config
        config.BUCKET_AUTOCONF_TIER2_ENABLED = true;
        config.BLOCK_STORE_FS_TMFS_ENABLED = true;
        config.TIERING_TTL_MS = 5 * 1000;
    });

    // What does "should work" even mean?
    // Should work under 2 flows:
    // - Write Flow:
    //    1. When an object is uploaded to a bucket with appropriate tiering policy
    //    the object should be written to the second tier directly.
    // - Read Flow:
    //    1. When an object is read it should be moved to the first tier.
    //    2. The tiering TTL worker should run and move the object to the second tier.
    mocha.it('should work', async function() {
        // eslint-disable-next-line no-invalid-this
        this.timeout(60_000);

        // Create a bucket with any name - with the above
        // config set it will already have 2 tiers such that
        // they share the storage pool and the second tier will
        // have storage class set to 'GLACIER'.
        /** @type {nb.Bucket} */
        const bucket = await rpc_client.bucket.create_bucket({ name: BUCKET_NAME });
        const tiers_by_order = bucket.tiering.tiers.reduce((acc, tier) => {
            // @ts-ignore
            acc[tier.order] = tier.tier.unwrap();
            return acc;
        }, {});

        // Upload an object to the bucket.
        const obj = await upload_object({ bucket: BUCKET_NAME, key: 'test' });

        // Verify that the object was written to the first tier.
        obj.chunks.forEach(chunk => {
            assert.strictEqual(String(chunk.tier.name.unwrap()), String(tiers_by_order[1]));
        });

        // Read the object.
        const object_md = await rpc_client.object.read_object_md({ bucket: BUCKET_NAME, key: 'test', obj_id: obj.obj_id });
        await object_io.read_entire_object({ client: rpc_client, object_md });

        await load_chunks(obj);
        obj.chunks.forEach(chunk => {
            // Verify that the object was moved to the first tier.
            assert.strictEqual(String(chunk.tier.name.unwrap()), String(tiers_by_order[0]));
        });

        await P.delay(config.TIERING_TTL_MS * 2);

        // Run the tiering TTL worker.
        await ttl_worker.run_batch();

        // Verify that the object was moved back to the second tier.
        await load_chunks(obj);
        obj.chunks.forEach(chunk => {
            assert.strictEqual(String(chunk.tier.name.unwrap()), String(tiers_by_order[1]));
        });
    });

    mocha.after(async function() {
        config.BUCKET_AUTOCONF_TIER2_ENABLED = false;
        config.BLOCK_STORE_FS_TMFS_ENABLED = false;
        config.TIERING_TTL_MS = default_ttl_ms;
    });
});
