/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const UsageReportStore = require('../analytic_services/usage_report_store').UsageReportStore;
const MDStore = require('../object_services/md_store').MDStore;
const system_utils = require('../utils/system_utils');
const size_utils = require('../../util/size_utils');
const auth_server = require('../common_services/auth_server');
const nodes_client = require('../node_services/nodes_client');
const node_allocator = require('../node_services/node_allocator');
const mapper = require('../object_services/mapper');

class TieringTTFWorker {
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.initialized = false;
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
        const multi_tiered_buckets = this._get_multi_tiered_buckets();
        if (!multi_tiered_buckets || !multi_tiered_buckets.length) {
            dbg.log0('no buckets with more than one tier. nothing to do');
            return config.TIER_TTF_WORKER_EMPTY_DELAY;
        }

        const wait = await this._rebuild_need_to_move_chunks(multi_tiered_buckets);
        console.log(`TieringTTFWorker: will wait ${wait} ms till next run`);
        return wait;
    }

    _get_multi_tiered_buckets() {
        return system_store.data.buckets.filter(bucket => bucket.tiering.tiers.length > 2);
    }

    async _rebuild_need_to_move_chunks(buckets) {
        const MAX_TTF = new size_utils.BigInteger(60); // one hour
        const TOO_BIG_TTF = 10; // in minutes

        function compare_buckets_by_TTF(bucket1, bucket2) {
            return bucket1.TTF - bucket2.TTF;
        }

        const now = Date.now();
        for (const bucket of buckets) {
            await node_allocator.refresh_tiering_alloc(bucket.tiering);
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const selected_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status);

            const storage = await nodes_client.instance().aggregate_data_free_by_tier([String(selected_tier._id)],
                selected_tier.system._id);
            const tier_storage_free = size_utils.json_to_bigint(storage[String(selected_tier._id)][0].free);
            const reports = await UsageReportStore.instance().get_usage_reports({
                since: now - (1000 * 60 * 60),
                till: now,
                bucket: bucket._id,
            });
            const report = reports[0];
            bucket.TTF = report && report.write_bytes ? tier_storage_free.divide(size_utils.json_to_bigint(report.write_bytes).divide(60)) :
                MAX_TTF; // time to fill in minutes
            bucket.tier = selected_tier._id;
        }
        const sorted_buckets = buckets.filter(bucket => bucket.TTF.lesser(TOO_BIG_TTF)).sort(compare_buckets_by_TTF);
        let chunks_to_rebuild = 0;
        if (_.isEmpty(sorted_buckets)) return config.TIER_TTF_WORKER_EMPTY_DELAY;
        for (const bucket of sorted_buckets) {
            switch (bucket.TTF.value) {
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
            if (!chunks_to_rebuild) return config.TIER_TTF_WORKER_EMPTY_DELAY;
            const chunk_ids = await MDStore.instance().find_oldest_tier_chunk_ids(bucket.tier, chunks_to_rebuild, 1);
            await node_allocator.refresh_tiering_alloc(bucket.tiering);
            const tiering_status = node_allocator.get_tiering_status(bucket.tiering);
            const next_tier = mapper.select_tier_for_write(bucket.tiering, tiering_status, bucket.tier);
            if (!next_tier) continue;
            console.log(`TieringTTFWorker: Moving the following ${chunks_to_rebuild} chunks to next tier ${next_tier._id}`, chunk_ids);
            await this._build_chunks(chunk_ids, next_tier._id);
        }
        return config.TIER_TTF_WORKER_BATCH_DELAY;
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



exports.TieringTTFWorker = TieringTTFWorker;
