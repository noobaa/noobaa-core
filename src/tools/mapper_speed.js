/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../sdk/nb')} nb */
/** @typedef {import('../server/system_services/system_store').SystemStore} SystemStore */

// const _ = require('lodash');
const util = require('util');
const crypto = require('crypto');
const mapper = require('../server/object_services/mapper');
const Speedometer = require('../util/speedometer');
const { ChunkAPI } = require('../sdk/map_api_types');
const db_client = require('../util/db_client');

require('../util/console_wrapper').original_console();

// override the default inspect options
util.inspect.defaultOptions.depth = 10;
util.inspect.defaultOptions.colors = true;
util.inspect.defaultOptions.breakLength = 60;

const speedo = new Speedometer('Mapper Speed');

async function main() {

    /** @type {nb.System} */
    const system = {
        _id: db_client.instance().new_object_id(),
        name: 'system',
        buckets_by_name: {},
        chunk_configs_by_id: {},
        pools_by_name: {},
        tiers_by_name: {},
        tiering_policies_by_name: {},
    };

    /** @type {nb.ChunkCoderConfig} */
    const chunk_coder_config = {
        replicas: 3,
        data_frags: 1,
        parity_frags: 0,
        lrc_frags: 0,
        digest_type: 'sha384',
        frag_digest_type: 'sha1',
        cipher_type: 'aes-256-gcm',
        compress_type: 'snappy',
        parity_type: 'isa-c1',
    };

    /** @type {nb.ChunkConfig} */
    const chunk_config = {
        _id: db_client.instance().new_object_id(),
        system,
        chunk_coder_config,
    };

    /** @type {nb.Pool} */
    const pool = {
        _id: db_client.instance().new_object_id(),
        name: 'pool',
        system,
        resource_type: 'HOSTS',
        pool_node_type: 'BLOCK_STORE_FS',
    };

    /** @type {nb.Tier} */
    const tier = {
        _id: db_client.instance().new_object_id(),
        name: 'tier',
        system,
        chunk_config,
        data_placement: 'SPREAD',
        mirrors: [{
            _id: db_client.instance().new_object_id(),
            spread_pools: [pool]
        }],
    };

    /** @type {nb.Tiering} */
    const tiering = {
        _id: db_client.instance().new_object_id(),
        name: 'tiering',
        system,
        tiers: [{ tier, order: 0, disabled: false }],
        chunk_split_config: { avg_chunk: 1, delta_chunk: 1 },
    };

    /** @type {nb.Bucket} */
    const bucket = {
        _id: db_client.instance().new_object_id(),
        name: 'bucket',
        system,
        tiering,
        versioning: 'DISABLED',
        storage_stats: { last_update: 0 },
    };

    /** @type {nb.MirrorStatus} */
    const FULL_STORAGE = {
        free: { peta: 2, n: 0 },
        regular_free: { peta: 1, n: 0 },
        redundant_free: { peta: 1, n: 0 }
    };

    /** @type {nb.TieringStatus} */
    const tiering_status = {
        [tier._id.toHexString()]: {
            mirrors_storage: tier.mirrors.map(mirror => FULL_STORAGE),
            pools: {
                [tier.mirrors[0].spread_pools[0]._id.toHexString()]: {
                    num_nodes: 1000,
                    resource_type: 'HOSTS',
                    valid_for_allocation: true,
                },
            },
        },
    };

    /** @type {nb.LocationInfo} */
    const location_info = {};

    /** @type {SystemStore} */
    const system_store = /** @type {SystemStore} */ (
        /** @type {unknown} */
        ({
            [util.inspect.custom]() { return 'SystemStore'; },
            data: {
                get_by_id(id_str) { return this.idmap[id_str]; },
                get_by_id_include_deleted(id_str, name) { return this.idmap[id_str]; },
                systems: [system],
                systems_by_name: {
                    [system.name]: system
                },
                pools: [pool],
                tiers: [tier],
                tieringpolicies: [tiering],
                buckets: [bucket],
                idmap: {
                    [system._id.toHexString()]: system,
                    [bucket._id.toHexString()]: bucket,
                    [tiering._id.toHexString()]: tiering,
                    [tier._id.toHexString()]: tier,
                    [pool._id.toHexString()]: pool,
                    [system._id.toHexString()]: system,
                },
                time: Date.now(),
                roles: [],
                accounts: [],
                clusters: [],
                agent_configs: [],
                chunk_configs: [],
                namespace_resources: [],
                accounts_by_email: {},
                cluster_by_server: {},
                check_indexes() { /*empty*/ },
                rebuild() { /*empty*/ },
                rebuild_accounts_by_email_lowercase() { /*empty*/ },
                rebuild_idmap() { /*empty*/ },
                rebuild_indexes() { /*empty*/ },
                rebuild_object_links() { /*empty*/ },
                resolve_object_ids_paths() { /*empty*/ },
                resolve_object_ids_recursive() { /*empty*/ },
            },
        })
    );

    const NUM_CHUNKS = 20;
    const CHUNK_SIZE = 4 * 1024 * 1024;
    for (;;) {
        for (let i = 0; i < NUM_CHUNKS; ++i) {
            /** @type {nb.ChunkInfo} */
            const chunk_info = {
                // _id: new_object_id().toHexString(),
                bucket_id: bucket._id.toHexString(),
                chunk_coder_config,
                size: CHUNK_SIZE,
                frag_size: CHUNK_SIZE,
                frags: [{
                    _id: db_client.instance().new_object_id().toHexString(),
                    data_index: 0,
                    digest_b64: crypto.createHash(chunk_coder_config.frag_digest_type).digest('base64'),
                    blocks: [],
                }],
                parts: [{
                    start: 0,
                    end: CHUNK_SIZE,
                    seq: 0,
                    obj_id: db_client.instance().new_object_id().toHexString(),
                    chunk_id: db_client.instance().new_object_id().toHexString(),
                    multipart_id: db_client.instance().new_object_id().toHexString(),
                }]
            };
            const chunk = new ChunkAPI(chunk_info, system_store);
            mapper.map_chunk(chunk, tier, tiering, tiering_status, location_info);

            console.log(chunk.chunk_info);
            for (const part of chunk.parts) {
                console.log('\n', part);
            }
            for (const frag of chunk.frags) {
                console.log('\n', frag);
                for (const block of frag.blocks) {
                    console.log('\n', block);
                }
            }
            process.exit(1);
        }
        await new Promise(resolve => setImmediate(resolve));
        speedo.update(NUM_CHUNKS * CHUNK_SIZE);
    }
}

main();
