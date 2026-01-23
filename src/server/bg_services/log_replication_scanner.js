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
const log_parser = require('./replication_log_parser');
const replication_utils = require('../utils/replication_utils');
const { BucketDiff } = require('../../server/utils/bucket_diff');

class LogReplicationScanner {

    /**
     * @param {{
     *   name: string;
     *   client: nb.APIClient;
     * }} params
     */
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this._scanner_sem = new semaphore.Semaphore(config.REPLICATION_SEMAPHORE_CAP, {
            timeout: config.REPLICATION_SEMAPHORE_TIMEOUT,
            timeout_error_code: 'LOG_REPLICATION_ITEM_TIMEOUT',
            verbose: true
        });
        this.noobaa_connection = undefined;
    }

    async run_batch() {
        if (!this._can_run()) return;
        dbg.log0('log_replication_scanner: starting scanning bucket replications');
        try {
            if (!this.noobaa_connection) {
                this.noobaa_connection = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
            }
            await this.scan();
        } catch (err) {
            dbg.error('log_replication_scanner:', err);
        }

        return config.BUCKET_LOG_REPLICATOR_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('log_replication_scanner: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async scan() {
        if (!this.noobaa_connection) throw new Error('noobaa endpoint connection is not started yet...');
        // Retrieve all replication policies with log-replication info from the DB
        const replications = await replication_store.find_log_based_replication_rules();

        // Iterate over the policies in parallel
        await P.all(_.map(replications, async repl => {
            _.map(repl.rules, async rule => {
                const replication_id = repl._id;
                const rule_id = rule.rule_id;

                const { src_bucket, dst_bucket } = replication_utils.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
                if (!src_bucket || !dst_bucket) {
                    dbg.error('log_replication_scanner: can not find src_bucket or dst_bucket object', src_bucket, dst_bucket);
                    // mark target bucket as unreachable (uses bucket id since bucket was deleted/not found)
                    if (src_bucket && !dst_bucket) {
                        replication_utils.update_replication_target_status(src_bucket.name, String(rule.destination_bucket), false);
                    }
                    return;
                }

                const candidates = await log_parser.get_log_candidates(
                    src_bucket._id,
                    rule_id,
                    repl,
                    config.AWS_LOG_CANDIDATES_LIMIT,
                    rule.sync_deletions
                );
                if (!candidates.items || !candidates.done) return;

                dbg.log1('log_replication_scanner: candidates: ', candidates.items);

                const sync_versions = rule.sync_versions || false;

                const sync_deletions = rule.sync_deletions || false;

                await this.process_candidates(
                    src_bucket, dst_bucket, candidates.items, sync_versions, sync_deletions, rule_id, replication_id);

                // Commit will save the continuation token for the next scan
                // This needs to be done only after the candidates were processed.
                // This is to avoid the scenario where we fail to process a set of candidates,
                // in such case we will not save the continuation token so that we can scan the 
                // same candidates again.
                await candidates.done();

                await replication_store.update_log_replication_status_by_id(replication_id, Date.now());
            });
        }));
    }

    /**
     * process_candidates takes the source and destination buckets and the candidates
     * and process them depending upon the kind of candidate.
     * @param {*} src_bucket source bucket
     * @param {*} dst_bucket destination bucket
     * @param {nb.ReplicationLogCandidates} candidates
     * @param {boolean} sync_versions should we sync object versions
     * @param {boolean} sync_deletions should we sync deletions
     * @param {string} rule_id
     * @param {string} replication_id
     */
    async process_candidates(src_bucket, dst_bucket, candidates, sync_versions, sync_deletions, rule_id, replication_id) {
        let copy_keys;
        let delete_keys;
        if (sync_versions) {
            copy_keys = await this.process_candidates_sync_version(src_bucket, dst_bucket, candidates, false);
            // for sync_versions enabled, deletions cannot be performed until the copying process is completed
            await this.copy_objects(src_bucket.name, dst_bucket.name, copy_keys, rule_id, replication_id);

            if (sync_deletions) { // If sync_deletions is enabled, then only the deletion keys for versioned objects are captured
                const diff_keys = await this.process_candidates_sync_version(src_bucket, dst_bucket, candidates, sync_deletions);
                delete_keys = Object.keys(diff_keys); // fetching keys array from diff_keys
                await this.delete_objects(dst_bucket.name, delete_keys);
            }
        } else {
            // here even if sync_deletions is disabled, we are processing delete_keys for not_sync_verison
            ({ copy_keys, delete_keys } = await this.process_candidates_not_sync_version(src_bucket, dst_bucket, candidates));

            // calling copy_objects and delete_objects in parallel by passing batch of keys
            await Promise.all([
                this.copy_objects(src_bucket.name, dst_bucket.name, copy_keys, rule_id, replication_id),
                this.delete_objects(dst_bucket.name, delete_keys)
            ]);
        }
        dbg.log1('log_replication_scanner: process_candidates copy_keys: ', copy_keys);
        dbg.log1('log_replication_scanner: process_candidates delete_keys: ', delete_keys);

        // Returning for testing purpose 
        return { copy_keys, delete_keys };
    }

    async process_candidates_sync_version(src_bucket, dst_bucket, candidates, sync_deletions) {
        const bucketDiff = new BucketDiff({
            first_bucket: src_bucket.name,
            second_bucket: dst_bucket.name,
            version: true,
            connection: this.noobaa_connection,
            for_replication: config.BUCKET_DIFF_FOR_REPLICATION,
            for_deletion: sync_deletions
        });
        dbg.log1('process_candidates_sync_version: sync_deletions: ', sync_deletions);
        // diff_keys can be either copy_keys or delete_keys based on the sync_deletions
        let diff_keys = {};

        try {
            for (const candidate of Object.values(candidates)) {
                const action = candidate.action;
                if (action === 'skip') {
                    // Log skipped candidate key
                    dbg.log1('process_candidates: skipped_key: ', candidate.key);
                } else {
                    // The action should not matter to get_buckets_diff, we will evaluate the action inside.
                    // This is because the order of the versions matter.  hance we just need the hint from the logs
                    // regarding which key was touched
                    const { keys_diff_map } = await bucketDiff.get_buckets_diff({
                        prefix: candidate.key,
                        max_keys: Number(process.env.REPLICATION_MAX_KEYS) || 1000, //max_keys refers her to the max number of versions (+deletes)
                        current_first_bucket_cont_token: '',
                        current_second_bucket_cont_token: '',
                    });
                    diff_keys = { ...diff_keys, ...keys_diff_map };
                }
            }
            // target bucket is reachable
            replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, true);
        } catch (err) {
            // target bucket is unreachable
            dbg.error('log_replication_scanner: failed to get buckets diff, target may be unreachable:',
                src_bucket.name, dst_bucket.name, err);
            replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, false);
            throw err;
        }

        dbg.log1('process_candidates_sync_version: diff_keys: ', diff_keys);
        // returning keys difference after processing candidates
        return diff_keys;
    }

    async process_candidates_not_sync_version(src_bucket, dst_bucket, candidates) {
        let src_dst_objects_list;
        try {
            src_dst_objects_list = await this.head_objects(src_bucket.name, dst_bucket.name, candidates);
            // target bucket is reachable
            replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, true);
        } catch (err) {
            // target bucket is unreachable
            dbg.error('log_replication_scanner: failed to head objects, target may be unreachable:',
                src_bucket.name, dst_bucket.name, err);
            replication_utils.update_replication_target_status(src_bucket.name, dst_bucket.name, false);
            throw err;
        }

        dbg.log1('log_replication_scanner: process_candidates src_dst_objects_list: ', src_dst_objects_list);

        const copy_keys = {};
        const delete_keys = [];

        for (const candidate of src_dst_objects_list) {
            const action = this.process_candidate(candidate);
            if (action === 'copy') {
                if (!Object.hasOwn(copy_keys, candidate.key)) {
                    copy_keys[candidate.key] = [];
                }
                copy_keys[candidate.key].push(candidate.src_object_info);
            } else if (action === 'delete') {
                delete_keys.push(candidate.key);
            } else {
                // Log skipped candidate key
                dbg.log1('process_candidates: skipped_key: ', candidates.key);
            }
        }

        // returning copy_keys and delete_keys after processing candidates
        return { copy_keys, delete_keys };
    }

    process_candidate(candidate) {
        // if there is no log for candidate then we should skip
        if (!candidate.data) {
            return 'skip';
        }

        // each candidate represents latest action per key
        const item = candidate.data;

        if (item.action === 'copy') {
            return this.process_copy_candidate(candidate);
        }

        if (item.action === 'delete') {
            return this.process_delete_candidate(candidate);
        }

        if (item.action === 'conflict') {
            return this.process_conflict_candidate(candidate);
        }
    }

    process_copy_candidate(candidate) {
        const src_object_info = candidate.src_object_info;
        const dst_object_info = candidate.dst_object_info;
        if (src_object_info && (!dst_object_info || (src_object_info.LastModified > dst_object_info.LastModified &&
                src_object_info.ETag !== dst_object_info.ETag))) {
            return 'copy';
        }
        return 'skip';
    }

    process_delete_candidate(candidate) {
        if (!candidate.src_object_info && candidate.dst_object_info) {
            return 'delete';
        }
        return 'skip';
    }

    process_conflict_candidate(candidate) {
        // If the item is present in the source bucket but not in the destination bucket
        // then it is 'copy' action
        if (candidate.src_object_info && !candidate.dst_object_info) {
            return 'copy';
        }

        // If the item is present in the destination bucket but not in the source bucket
        // then it is 'delete' action
        if (!candidate.src_object_info && candidate.dst_object_info) {
            return 'delete';
        }
        return 'skip';
    }

    /**
     * @param {any} src_bucket_name
     * @param {any} dst_bucket_name
     * @param {nb.BucketDiffKeysDiff | {}} keys_diff_map
     * @param {string} rule_id
     * @param {string} replication_id
     */
    async copy_objects(src_bucket_name, dst_bucket_name, keys_diff_map, rule_id, replication_id) {
        if (!Object.keys(keys_diff_map).length) return;
        const copy_type = replication_utils.get_copy_type();
        const copy_res = await replication_utils.copy_objects(
            this._scanner_sem,
            this.client,
            copy_type,
            src_bucket_name.unwrap(),
            dst_bucket_name.unwrap(),
            keys_diff_map,
        );
        dbg.log2('log_replication_scanner: scan copy_objects: ', keys_diff_map);
        // in case of log-based replication there is no need for the src_cont_token, hance the undefined.
        const replication_status = replication_utils.get_rule_status(rule_id, undefined, keys_diff_map, copy_res);

        replication_utils.update_replication_prom_report(src_bucket_name, replication_id, replication_status);
    }

    async delete_objects(bucket_name, keys) {
        await replication_utils.delete_objects(
            this._scanner_sem,
            this.client,
            bucket_name.unwrap(),
            keys,
        );
        dbg.log2('log_replication_scanner: scan delete_objects: ', keys);
    }

    /**
     * head_objects takes the source and destination buckets and the candidates
     * and queries the source and destination buckets for the objects info and returns
     * an array of objects.
     * @param {nb.SensitiveString} src_bucket_name 
     * @param {nb.SensitiveString} dst_bucket_name 
     * @param {nb.ReplicationLogCandidates} candidates 
     * @returns {Promise<Array<{
     *  key: string,
     *  data: { action: nb.ReplicationLogAction, time: Date },
     *  src_object_info: AWS.S3.HeadObjectOutput | null,
     *  dst_object_info: AWS.S3.HeadObjectOutput | null
     * }>>}
     */
    async head_objects(src_bucket_name, dst_bucket_name, candidates) {
        const src_dst_objects_info = await P.all(Object.entries(candidates).map(async ([key, value]) => {
            try {
                dbg.log1('log_replication_scanner head_object: params:', src_bucket_name, key, value);

                const src_dst_object_info = await P.all(
                    [
                        await replication_utils.get_object_md(src_bucket_name, key, this.noobaa_connection, undefined),
                        await replication_utils.get_object_md(dst_bucket_name, key, this.noobaa_connection, undefined),
                    ]
                );

                dbg.log1('log_replication_scanner.head_object: finished successfully', src_dst_object_info);

                return {
                    key: key,
                    data: value,
                    src_object_info: src_dst_object_info[0],
                    dst_object_info: src_dst_object_info[1],
                };
            } catch (err) {
                dbg.error('log_replication_scanner.head_objects: error:', err);
                throw err;
            }
        }));

        return src_dst_objects_info;
    }
}

exports.LogReplicationScanner = LogReplicationScanner;
