/* Copyright (C) 2016 NooBaa */
'use strict';

const moment = require('moment');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const MDStore = require('../object_services/md_store').MDStore;
const system_utils = require('../utils/system_utils');
const auth_server = require('../common_services/auth_server');
const node_allocator = require('../node_services/node_allocator');
const mapper = require('../object_services/mapper');

/**
 * TieringTTLWorker is a background worker that runs periodically to move chunks
 * from the first tier to the next tier in the tiering policy.
 * 
 * The selection of the chunks is based on the BG's TTL configuration. The BG
 * worker relies on `evict_block` RPC which implies that the associated blocks
 * stores must implement the `evict_block` RPC.
 */
class TieringTTLWorker {
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.initialized = false;
        this.last_run = 'force';
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('TieringTTLWorker: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async run_batch() {
        if (!this._can_run()) return;

        dbg.log0('TieringTTLWorker: start running');
        const candidate_buckets = this._get_candidate_buckets();
        if (!candidate_buckets || !candidate_buckets.length) {
            dbg.log0('no buckets with more than one tier. nothing to do');
            this.last_run = 'force';
            return config.TIERING_TTL_WORKER_BATCH_DELAY;
        }

        const wait = await this._ttl_move_chunks(candidate_buckets);
        console.log(`TieringTTLWorker: will wait ${wait} ms till next run`);
        return wait;
    }

    _get_candidate_buckets() {
        return system_store.data.buckets.filter(bucket =>
            !bucket.deleting && (
                // only include buckets that have 2 or more tiers
                (bucket.tiering && bucket.tiering.tiers.length > 1)
            ));
    }

    async _ttl_move_chunks(buckets) {
        const chunks_to_move = config.TIERING_TTL_WORKER_BATCH_SIZE;

        for (const bucket of buckets) {
            await node_allocator.refresh_tiering_alloc(bucket.tiering, this.last_run);
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const previous_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
            const next_tier_order = this.find_tier_order_in_tiering(bucket, previous_tier) + 1;
            const next_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status, next_tier_order);

            // no point in calling build_chunks when there is no next_tier
            if (!next_tier) continue;

            const next_tier_id = next_tier._id;

            const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids({
                tier: previous_tier._id,
                limit: chunks_to_move,
                sort_direction: 1,
                max_tier_lru: moment().subtract(config.TIERING_TTL_MS, 'ms').toDate(),
            });
            if (!chunk_ids.length) continue;

            await this._build_chunks(chunk_ids, next_tier_id, false);
        }

        this.last_run = undefined;
        return config.TIERING_TTL_WORKER_BATCH_DELAY;
    }

    find_tier_order_in_tiering(bucket, tier) {
        return bucket.tiering.tiers.find(t => String(t.tier._id) === String(tier._id)).order;
    }

    async _build_chunks(chunk_ids, next_tier, cache_evict) {
        return this.client.scrubber.build_chunks({
            chunk_ids,
            tier: next_tier,
            evict: cache_evict,
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                role: 'admin'
            })
        });
    }
}



exports.TieringTTLWorker = TieringTTLWorker;
