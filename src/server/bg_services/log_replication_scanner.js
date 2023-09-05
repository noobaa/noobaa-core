/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const system_store = require('../system_services/system_store').get_instance();
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const config = require('../../../config');
const P = require('../../util/promise');
const Semaphore = require('../../util/semaphore');
const replication_store = require('../system_services/replication_store').instance();
const cloud_utils = require('../../util/cloud_utils');
const log_parser = require('./replication_log_parser');
const replication_utils = require('../utils/replication_utils');

// eslint-disable-next-line no-unused-vars
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
        this._scanner_sem = new Semaphore(config.REPLICATION_SEMAPHORE_CAP, {
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

                const { src_bucket, dst_bucket } = replication_utils.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
                if (!src_bucket || !dst_bucket) {
                    dbg.error('log_replication_scanner: can not find src_bucket or dst_bucket object', src_bucket, dst_bucket);
                    return;
                }

                const candidates = await log_parser.get_log_candidates(
                    src_bucket._id,
                    rule.rule_id,
                    repl,
                    config.AWS_LOG_CANDIDATES_LIMIT,
                    rule.sync_deletions
                );
                if (!candidates.items || !candidates.done) return;

                dbg.log1('log_replication_scanner: candidates: ', candidates.items);

                await this.process_candidates(src_bucket, dst_bucket, candidates.items);

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
     */
    async process_candidates(src_bucket, dst_bucket, candidates) {
        const src_dst_objects_list = await this.head_objects(src_bucket.name, dst_bucket.name, candidates);

        dbg.log1('log_replication_scanner: process_candidates src_dst_objects_list: ', src_dst_objects_list);

        const copy_keys = [];
        const delete_keys = [];

        for (const candidate of src_dst_objects_list) {
            const action = this.process_candidate(candidate);
            if (action === 'copy') {
                copy_keys.push(candidate.key);
            } else if (action === 'delete') {
                delete_keys.push(candidate.key);
            } else {
                // Log skipped candidate key
                dbg.log1('process_candidates: skipped_key: ', candidates.key);
            }
        }

        dbg.log1('log_replication_scanner: process_candidates copy_keys: ', copy_keys);
        dbg.log1('log_replication_scanner: process_candidates delete_keys: ', delete_keys);

        // calling copy_objects and delete_objects by passing batch of keys
        await Promise.all([
            this.copy_objects(src_bucket.name, dst_bucket.name, copy_keys),
            this.delete_objects(dst_bucket.name, delete_keys)
        ]);

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

    async copy_objects(src_bucket_name, dst_bucket_name, keys) {
        const copy_type = replication_utils.get_copy_type();
        await replication_utils.copy_objects(
            this._scanner_sem,
            this.client,
            copy_type,
            src_bucket_name.unwrap(),
            dst_bucket_name.unwrap(),
            keys,
        );
        dbg.log2('log_replication_scanner: scan copy_objects: ', keys);
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
                        await this.noobaa_connection.headObject({
                            Bucket: src_bucket_name.unwrap(),
                            Key: key
                        })
                        .promise()
                        .catch(err => {
                            // We do expect to get NotFound error if the object was deleted
                            if (err.code === 'NotFound') {
                                return null;
                            }

                            throw err;
                        }),

                        await this.noobaa_connection.headObject({
                            Bucket: dst_bucket_name.unwrap(),
                            Key: key
                        })
                        .promise()
                        .catch(err => {
                            // We do expect to get NotFound error if the object hasn't been copied yet
                            if (err.code === 'NotFound') {
                                return null;
                            }

                            throw err;
                        }),
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
