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
        const replications = await replication_store.find_aws_log_based_replication_rules();

        // Iterate over the policies in parallel
        await P.all(_.map(replications, async repl => {
            _.map(repl.rules, async rule => {
                // At the moment this scanner just supports deletions
                // hence if sync_deletions is false we can skip the entire
                // rule completely
                //
                // NOTE: Should be removed once we support other operations
                // as well
                if (!rule.sync_deletions) {
                    dbg.log0('log_replication_scanner: skipping rule', rule.rule_id, 'because sync_deletions is false');
                    return;
                }

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
                    entry => {
                        // If sync_deletions is true then nothing is to be ignored
                        // hence return false
                        if (rule.sync_deletions) return false;

                        // If sync_deletions is false then we need to ignore
                        // the DELETE.OBJECT operations
                        return entry?.operation?.includes('DELETE.OBJECT');
                    }
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

    async process_candidates(src_bucket, dst_bucket, candidates) {
        const src_dst_objects_list = await this.head_objects(src_bucket.name, dst_bucket.name, candidates);

        for (const candidate of src_dst_objects_list) {
            if (candidate.data.action === 'copy') {
                // TODO: Cannot do it yet because it seems that the AWS logs
                // are not ordered by time
            }

            if (candidate.data.action === 'delete') {
                await this.process_delete_candidate(src_bucket, dst_bucket, candidate);
            }
        }
    }

    async process_delete_candidate(src_bucket, dst_bucket, candidate) {
        if (!candidate.src_object_info && candidate.dst_object_info) {
            await this.delete_object(dst_bucket.name, candidate.key);
        }
    }

    async delete_object(bucket_name, key) {
        await replication_utils.delete_objects(
            this._scanner_sem,
            this.client,
            bucket_name.unwrap(),
            [key],
        );
        dbg.log2('log_replication_scanner: scan delete_object: ', key);
    }

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
