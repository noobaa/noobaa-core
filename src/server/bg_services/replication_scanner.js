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
            const { had_work, had_errors } = await this.scan();
            // Retry soon when this batch copied objects or a rule failed. An idle batch waits the full delay.
            return (had_work || had_errors) ? config.BUCKET_REPLICATOR_BUSY_DELAY : config.BUCKET_REPLICATOR_DELAY;
        } catch (err) {
            dbg.error('replication_scanner:', err, err.stack);
            // Keep scanner responsive after partial progress or transient failures.
            return config.BUCKET_REPLICATOR_BUSY_DELAY;
        }
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
        const result = { had_work: false, had_errors: false };
        let least_recently_replicated_rules;
        try {
            await replication_utils.reconcile_replication_target_status();
            // find rule for each replication policy that was not updated for the longest period
            least_recently_replicated_rules = await replication_store.find_rules_updated_longest_time_ago();
        } catch (err) {
            result.had_errors = true;
            dbg.error('replication_scanner: failed to load replication rules:', err);
            return result;
        }

        await P.all(_.map(least_recently_replicated_rules, async replication_id_and_rule => {
            try {
                await this.scan_rule(replication_id_and_rule, result);
            } catch (err) {
                result.had_errors = true;
                dbg.error('replication_scanner: rule failed:', replication_id_and_rule.replication_id, replication_id_and_rule.rule?.rule_id, err);
            }
        }));

        return result;
    }

    /**
     * scan_rule diffs one rule and executes the copy.
     * @param {{ replication_id: string, rule: { rule_id: string } }} replication_id_and_rule
     * @param {{ had_work: boolean, had_errors: boolean }} result
     */
    async scan_rule(replication_id_and_rule, result) {
        const { replication_id, rule } = replication_id_and_rule;
        const status = { last_cycle_start: Date.now() };

        const { src_bucket, dst_bucket } = replication_utils.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
        // A missing bucket is recorded inside validate_src or validate_dst. It does not count as batch work or a retryable error.
        if (!await this.validate_src(src_bucket, replication_id)) return;
        if (!await this.validate_dst(src_bucket, dst_bucket, replication_id, rule, status)) return;

        const { keys_diff_map, src_cont_token, dst_cont_token } = await this.get_rule_diff(src_bucket, dst_bucket, replication_id, rule);

        dbg.log1('scan_rule:: keys_sizes_map_to_copy:', keys_diff_map, 'src_cont_token:', src_cont_token, 'dst_cont_token', dst_cont_token);

        // TODO: instead of calling execute, we should insert to the queue and process it in the background by the consumers
        const had_copy_errors = await this.execute(
            src_bucket, dst_bucket, keys_diff_map, replication_id, rule.rule_id, status,
            { src_cont_token, dst_cont_token });
        if (had_copy_errors) result.had_errors = true;

        // This rule copied objects or has more pages to scan.
        if (Object.keys(keys_diff_map).length || src_cont_token) result.had_work = true;
    }

    /**
     * get_rule_diff lists one page of the source and destination and returns the keys to copy.
     * @param {*} src_bucket
     * @param {*} dst_bucket
     * @param {string} replication_id
     * @param {{ rule_id: string, filter?: { prefix?: string }, sync_versions?: boolean, rule_status?: { src_cont_token?: string, dst_cont_token?: string } }} rule
     * @returns {Promise<{ keys_diff_map: nb.BucketDiffKeysDiff | {}, src_cont_token: string, dst_cont_token: string }>}
     */
    async get_rule_diff(src_bucket, dst_bucket, replication_id, rule) {
        const prefix = rule.filter?.prefix || '';
        const cur_src_cont_token = rule.rule_status?.src_cont_token || '';
        const cur_dst_cont_token = rule.rule_status?.dst_cont_token || '';
        const sync_versions = rule.sync_versions || false;

        const bucketDiff = new BucketDiff({
            first_bucket: src_bucket.name,
            second_bucket: dst_bucket.name,
            version: sync_versions,
            connection: this.noobaa_connection,
            for_replication: config.BUCKET_DIFF_FOR_REPLICATION,
            skip_user_metadata_check: config.BUCKET_REPLICATION_SKIP_METADATA_CHECK_NON_VERSIONED,
        });

        dbg.log1(`scan:: cur_src_cont_token: ${cur_src_cont_token},cur_dst_cont_token: ${cur_dst_cont_token}`);

        try {
            const buckets_diff_result = await bucketDiff.get_buckets_diff({
                prefix,
                max_keys: Number(process.env.REPLICATION_MAX_KEYS) || 1000,
                current_first_bucket_cont_token: cur_src_cont_token,
                current_second_bucket_cont_token: cur_dst_cont_token,
            });

            return {
                keys_diff_map: buckets_diff_result.keys_diff_map,
                src_cont_token: buckets_diff_result.first_bucket_cont_token,
                dst_cont_token: buckets_diff_result.second_bucket_cont_token,
            };
        } catch (err) {
            replication_utils.update_replication_target_status(replication_id, src_bucket.name, dst_bucket.name, false);
            replication_utils.report_failed_replication_cycle(src_bucket.name, replication_id,
                rule.rule_id, _.get(src_bucket, 'storage_stats.objects_count', 0));
            throw err;
        }
    }

    /**
     * validate_src records a failure when the source bucket is missing.
     * @param {*} src_bucket
     * @param {string} replication_id
     * @returns {Promise<boolean>}
     */
    async validate_src(src_bucket, replication_id) {
        if (src_bucket) return true;

        dbg.error('replication_scanner: can not find src_bucket', src_bucket);
        replication_utils.clear_replication_target_status_for_orphan_policy(replication_id);
        return false;
    }

    /**
     * validate_dst records a failure when the destination bucket is missing.
     * @param {*} src_bucket
     * @param {*} dst_bucket
     * @param {string} replication_id
     * @param {{ rule_id: string, destination_bucket: *, rule_status?: { src_cont_token?: string, dst_cont_token?: string } }} rule
     * @param {{ last_cycle_start: number }} status
     * @returns {Promise<boolean>}
     */
    async validate_dst(src_bucket, dst_bucket, replication_id, rule, status) {
        if (dst_bucket) return true;

        dbg.error('replication_scanner: can not find dst_bucket', dst_bucket);
        const dst_bucket_name = await replication_utils.resolve_destination_bucket_name(rule.destination_bucket);
        replication_utils.update_replication_target_status(replication_id, src_bucket.name, dst_bucket_name, false);
        replication_utils.report_failed_replication_cycle(src_bucket.name, replication_id,
            rule.rule_id, _.get(src_bucket, 'storage_stats.objects_count', 0));
        // advance last_cycle_end for rule rotation; keep cont tokens so replication resumes where it left off
        await replication_store.update_replication_status_by_id(replication_id, rule.rule_id, {
            ...status,
            last_cycle_end: Date.now(),
            src_cont_token: (rule.rule_status && rule.rule_status.src_cont_token) || '',
            dst_cont_token: (rule.rule_status && rule.rule_status.dst_cont_token) || '',
        });
        return false;
    }

    /**
     * execute copies one rule's diff, then stores the scan cursor and metrics.
     * @param {{ name: nb.SensitiveString }} src_bucket
     * @param {{ name: nb.SensitiveString }} dst_bucket
     * @param {nb.BucketDiffKeysDiff | {}} keys_diff_map
     * @param {string} replication_id
     * @param {string} rule_id
     * @param {{ last_cycle_start: number }} status
     * @param {{ src_cont_token: string, dst_cont_token: string }} cont_tokens
     * @returns {Promise<boolean>} true when at least one object in the diff was not copied
     */
    async execute(src_bucket, dst_bucket, keys_diff_map, replication_id, rule_id, status, cont_tokens) {
        const { src_cont_token, dst_cont_token } = cont_tokens;

        let copy_res = { num_of_objects: 0, size_of_objects: 0 };
        let had_copy_errors = false;

        if (Object.keys(keys_diff_map).length) {
            const copy_type = replication_utils.get_copy_type();
            const copy_result = await replication_utils.copy_objects(this.scanner_semaphore, this.client, copy_type,
                src_bucket.name, dst_bucket.name, keys_diff_map, replication_id);
            copy_res = copy_result || copy_res;
            dbg.log0('replication_scanner: scan copy_res:', copy_res);
        } else {
            replication_utils.update_replication_target_status(replication_id, src_bucket.name, dst_bucket.name, true);
        }

        // always advance the src cont token, if failures happened - they will eventually will be copied
        const new_status = { ...status, last_cycle_end: Date.now(), src_cont_token, dst_cont_token };
        await replication_store.update_replication_status_by_id(replication_id, rule_id, new_status);

        // update the prometheus metrics only if we have diff
        if (Object.keys(keys_diff_map).length) {
            const {rule_status, bucket_status} = replication_utils.get_rule_and_bucket_status(
                rule_id, src_cont_token, keys_diff_map, copy_res);
            replication_utils.update_replication_prom_report(src_bucket.name, replication_id, rule_status, bucket_status);
            had_copy_errors = rule_status.last_cycle_error_writes_num > 0;
        }
        return had_copy_errors;
    }
}

exports.ReplicationScanner = ReplicationScanner;
