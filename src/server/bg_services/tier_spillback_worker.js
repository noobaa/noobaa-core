/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const MDStore = require('../object_services/md_store').MDStore;
const system_utils = require('../utils/system_utils');
const size_utils = require('../../util/size_utils');
const auth_server = require('../common_services/auth_server');
const nodes_client = require('../node_services/nodes_client');
const node_allocator = require('../node_services/node_allocator');
const mapper = require('../object_services/mapper');

class TieringSpillbackWorker {
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.initialized = false;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('TieringSpillbackWorker: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async run_batch() {
        if (!this._can_run()) return;

        console.log('TieringSpillbackWorker: start running');
        const spillback_buckets = this._get_spillback_buckets();
        if (!spillback_buckets || !spillback_buckets.length) {
            dbg.log2('no buckets with spillback tier. nothing to do');
            return config.TIER_SPILLBACK_WORKER_EMPTY_DELAY;
        }
        const wait = await this._spillback_need_to_move_chunks(spillback_buckets);
        console.log(`TieringSpillbackWorker: will wait ${wait} ms till next run`);
        return wait;
    }

    _get_spillback_buckets() {
        return system_store.data.buckets.filter(bucket =>
            _.isUndefined(bucket.deleting) &&
            _.some(bucket.tiering && bucket.tiering.tiers, t => t.spillover));
    }

    async _spillback_need_to_move_chunks(buckets) {
        for (const bucket of buckets) {
            await node_allocator.refresh_tiering_alloc(bucket.tiering);
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
            const spillback_tier = _.find(bucket.tiering.tiers, t => t.spillover).tier;
            const storage = await nodes_client.instance().aggregate_data_free_by_tier([String(selected_tier._id)],
                selected_tier.system._id);
            const tier_storage_free = size_utils.json_to_bigint(storage[String(selected_tier._id)][0].free);
            if (tier_storage_free.greater(new size_utils.BigInteger(config.TIER_SPILLBACK_MIN_FREE))) {
                const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids(spillback_tier._id,
                    config.TIER_SPILLBACK_BATCH_SIZE, -1); // newest
                if (chunk_ids.length === 0) break;
                await this._build_chunks(chunk_ids, selected_tier._id);
                return config.TIER_SPILLBACK_BATCH_DELAY;
            }
        }
        return config.TIER_SPILLBACK_EMPTY_DELAY;
    }

    async _build_chunks(chunk_ids, next_tier) {
        return this.client.scrubber.build_chunks({ chunk_ids, tier: next_tier }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                role: 'admin'
            })
        });
    }
}



exports.TieringSpillbackWorker = TieringSpillbackWorker;
