/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const system_store = require('../system_services/system_store').get_instance();
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const config = require('../../../config');
const P = require('../../util/promise');
const semaphore = require('../../util/semaphore');
const replication_store = require('../system_services/replication_store').instance();
const cloud_utils = require('../../util/cloud_utils');
const replication_utils = require('../utils/replication_utils');
const { BucketDiff } = require('../../server/utils/bucket_diff');

class ReplicationScanner {

    /**
     * @param {{
     *   name: string;
     *   client: nb.APIClient;
     * }} params
     */
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.scanner_semaphore = new semaphore.Semaphore(config.REPLICATION_SEMAPHORE_CAP, {
            timeout: config.REPLICATION_SEMAPHORE_TIMEOUT,
            timeout_error_code: 'REPLICATION_ITEM_TIMEOUT',
            verbose: true
        });
        this.noobaa_connection = undefined;
    }

    async run_batch() {
        if (!this._can_run()) return;
        dbg.log0('replication_scanner: starting scanning bucket replications');
        try {
            if (!this.noobaa_connection) {
                this.noobaa_connection = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
            }
            await this.scan();
        } catch (err) {
            dbg.error('replication_scanner:', err, err.stack);
        }
        return config.BUCKET_REPLICATOR_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('replication_scanner: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async scan() {
        if (!this.noobaa_connection) throw new Error('noobaa endpoint connection is not started yet...');
        // find rule for each replication policy that was not updated for the longest period
        const least_recently_replicated_rules = await replication_store.find_rules_updated_longest_time_ago();

        await P.all(_.map(least_recently_replicated_rules, async replication_id_and_rule => {
            const { replication_id, rule } = replication_id_and_rule;
            const status = { last_cycle_start: Date.now() };

            const { src_bucket, dst_bucket } = replication_utils.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
            if (!src_bucket || !dst_bucket) {
                dbg.error('replication_scanner: can not find src_bucket or dst_bucket object', src_bucket, dst_bucket);
                // mark target bucket as unreachable (uses bucket id since bucket was deleted/not found)
                if (src_bucket && !dst_bucket) {
                    replication_utils.update_replication_target_status(src_bucket.name, String(rule.destination_bucket), false);
                }
                return;
            }
            const prefix = (rule.filter && rule.filter.prefix) || '';
            const cur_src_cont_token = (rule.rule_status && rule.rule_status.src_cont_token) || '';
            const cur_dst_cont_token = (rule.rule_status && rule.rule_status.dst_cont_token) || '';

            const sync_versions = rule.sync_versions || false;

            const bucketDiff = new BucketDiff({
                first_bucket: src_bucket.name,
                second_bucket: dst_bucket.name,
                version: sync_versions,
                connection: this.noobaa_connection,
                for_replication: config.BUCKET_DIFF_FOR_REPLICATION
            });
            dbg.log1(`scan:: cur_src_cont_token: ${cur_src_cont_token},cur_dst_cont_token: ${cur_dst_cont_token}`);

            let keys_diff_map;
            let src_cont_token;
            let dst_cont_token;

            try {
                const buckets_diff_result = await bucketDiff.get_buckets_diff({
                    prefix,
                    max_keys: Number(process.env.REPLICATION_MAX_KEYS) || 1000,
                    current_first_bucket_cont_token: cur_src_cont_token,
                    current_second_bucket_cont_token: cur_dst_cont_token,
                });

                keys_diff_map = buckets_diff_result.keys_diff_map;
                src_cont_token = buckets_diff_result.first_bucket_cont_token;
                dst_cont_token = buckets_diff_result.second_bucket_cont_token;

                // target bucket is reachable
                replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, true);
            } catch (err) {
                // target bucket is unreachable
                dbg.error('replication_scanner: failed to get buckets diff, target may be unreachable:',
                    src_bucket.name, dst_bucket.name, err);
                replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, false);
                throw err;
            }

            dbg.log1('scan:: keys_sizes_map_to_copy:', keys_diff_map, 'src_cont_token:', src_cont_token, 'dst_cont_token', dst_cont_token);
            let copy_res = {
                num_of_objects: 0,
                size_of_objects: 0
            };
            if (Object.keys(keys_diff_map).length) {
                const copy_type = replication_utils.get_copy_type();
                copy_res = await replication_utils.copy_objects(
                    this.scanner_semaphore,
                    this.client,
                    copy_type,
                    src_bucket.name,
                    dst_bucket.name,
                    keys_diff_map,
                );
                dbg.log0('replication_scanner: scan copy_res:', copy_res);
            }

            await replication_store.update_replication_status_by_id(replication_id,
                rule.rule_id, {
                    ...status,
                    last_cycle_end: Date.now(),
                    src_cont_token,
                    dst_cont_token
                    // always advance the src cont token, if failures happened - they will eventually will be copied
                });

            // update the prometheus metrics only if we have diff
            if (Object.keys(keys_diff_map).length) {
                const {rule_status, bucket_status} = replication_utils.get_rule_and_bucket_status(
                    rule.rule_id, src_cont_token, keys_diff_map, copy_res);

                replication_utils.update_replication_prom_report(src_bucket.name, replication_id, rule_status, bucket_status);
            }
        }));
    }
}

exports.ReplicationScanner = ReplicationScanner;
