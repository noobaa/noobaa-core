/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const usage_aggregator = require('./usage_aggregator');
const MDStore = require('../object_services/md_store').MDStore;
const system_utils = require('../utils/system_utils');
const size_utils = require('../../util/size_utils');
const auth_server = require('../common_services/auth_server');
const node_allocator = require('../node_services/node_allocator');
const mapper = require('../object_services/mapper');

class TieringTTFWorker {
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.initialized = false;
        this.last_run = 'force';
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('TieringTTFWorker: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async run_batch() {
        if (!this._can_run()) return;

        console.log('TieringTTFWorker: start running');
        const candidate_buckets = this._get_candidate_buckets();
        if (!candidate_buckets || !candidate_buckets.length) {
            dbg.log0('no buckets with more than one tier. nothing to do');
            this.last_run = 'force';
            return config.TIER_TTF_WORKER_EMPTY_DELAY;
        }

        const wait = await this._rebuild_need_to_move_chunks(candidate_buckets);
        console.log(`TieringTTFWorker: will wait ${wait} ms till next run`);
        return wait;
    }

    _get_candidate_buckets() {
        return system_store.data.buckets.filter(bucket =>
            !bucket.deleting && (
                // including buckets that have 2 or more tiers
                (bucket.tiering && bucket.tiering.tiers.length > 1) ||
                // including cache buckets to handle chunk eviction
                (bucket.namespace && bucket.namespace.caching)
            ));
    }

    async _rebuild_need_to_move_chunks(buckets) {
        const MAX_TTF = new size_utils.BigInteger(60); // one hour
        const TOO_BIG_TTF = 10; // in minutes

        function compare_buckets_by_TTF(bucket1, bucket2) {
            return bucket1.TTF - bucket2.TTF;
        }

        const now = Date.now();
        for (const bucket of buckets) {
            await node_allocator.refresh_tiering_alloc(bucket.tiering, this.last_run);
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
            const tier_storage_free = size_utils.json_to_bigint(size_utils.reduce_minimum(
                'free', tiering_status[String(selected_tier._id)].mirrors_storage.map(storage => (storage.free || 0))
            ));
            const valid = _.values(tiering_status[String(selected_tier._id)].pools).every(pool => pool.valid_for_allocation);
            const reports = await usage_aggregator.get_bandwidth_report({
                bucket: bucket._id,
                since: now - (1000 * 60 * 60),
                till: now,
                time_range: 'hour'
            });
            const report = reports[0];
            const time = valid && report ? Math.floor((now - report.timestamp) / 1000 / 60) : 60;
            bucket.TTF = valid && report && report.write_bytes ? tier_storage_free
                .divide(size_utils.json_to_bigint(report.write_bytes).divide(time)) : // how much time in minutes will it take to fill (avg by last report)
                MAX_TTF; // time to fill in minutes
            dbg.log1('TTF bucket', bucket.name, 'storage_free', tier_storage_free, 'report', report, 'TTF:', bucket.TTF);
        }
        const sorted_buckets = buckets.filter(bucket => bucket.TTF.lesser(TOO_BIG_TTF)).sort(compare_buckets_by_TTF);
        let chunks_to_rebuild = 0;
        if (_.isEmpty(sorted_buckets)) {
            this.last_run = 'force';
            return config.TIER_TTF_WORKER_EMPTY_DELAY;
        }
        for (const bucket of sorted_buckets) {
            const bucket_ttf = bucket.TTF.toJSNumber();
            switch (bucket_ttf) {
                case 0:
                    chunks_to_rebuild = 30;
                    break;
                case 1:
                    chunks_to_rebuild = 20;
                    break;
                case 2:
                    chunks_to_rebuild = 15;
                    break;
                case 3:
                    chunks_to_rebuild = 10;
                    break;
                case 4:
                    chunks_to_rebuild = 5;
                    break;
                case 5:
                    chunks_to_rebuild = 4;
                    break;
                case 6:
                    chunks_to_rebuild = 3;
                    break;
                case 7:
                    chunks_to_rebuild = 2;
                    break;
                default:
                    chunks_to_rebuild = 1;
            }
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const previous_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);
            const next_tier_order = this.find_tier_order_in_tiering(bucket, previous_tier) + 1;
            const next_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status, next_tier_order);

            // for cache buckets when we are on the last tier, we evict the chunks
            const cache_evict = bucket.namespace.caching && !next_tier;

            // no point in calling build_chunks when there is no next_tier or evict
            if (!next_tier && !cache_evict) continue;

            const next_tier_id = next_tier ? next_tier._id : undefined;

            const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids(previous_tier._id, chunks_to_rebuild, 1);
            if (!chunk_ids.length) continue;

            if (cache_evict) {
                console.log(`TieringTTFWorker: Evicting following ${chunks_to_rebuild} from ${previous_tier._id} `, chunk_ids);
            } else {
                console.log(`TieringTTFWorker: Moving the following ${chunks_to_rebuild} from ${previous_tier._id} to chunks to next tier ${next_tier_id}`, chunk_ids);
            }

            await this._build_chunks(
                chunk_ids,
                next_tier_id,
                cache_evict
            );
        }
        this.last_run = undefined;
        return config.TIER_TTF_WORKER_BATCH_DELAY;
    }

    find_tier_order_in_tiering(bucket, tier) {
        return bucket.tiering.tiers.find(t => String(t.tier._id) === String(tier._id)).order;
    }

    async _build_chunks(chunk_ids, next_tier, cache_evict) {
        return this.client.scrubber.build_chunks({ chunk_ids, tier: next_tier, evict: cache_evict }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                role: 'admin'
            })
        });
    }
}



exports.TieringTTFWorker = TieringTTFWorker;
