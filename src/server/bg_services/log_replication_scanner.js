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
            dbg.error('log_replication_scanner:', err, err.stack);
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

        const replications = await replication_store.find_aws_log_based_replication_rules();

        await P.all(_.map(replications, async repl => {
            _.map(repl.rules, async rule => {
                const replication_id = repl._id;

                const { src_bucket, dst_bucket } = replication_utils.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
                if (!src_bucket || !dst_bucket) {
                    dbg.error('log_replication_scanner: can not find src_bucket or dst_bucket object', src_bucket, dst_bucket);
                    return;
                }

                const candidates = await log_parser.get_log_candidates(src_bucket._id, repl);

                const keys_sizes_map_to_copy = await this.head_buckets_and_compare(src_bucket.name, dst_bucket.name, candidates);

                dbg.log1('log_replication_scanner: keys_sizes_map_to_copy: ', keys_sizes_map_to_copy);
                let move_res;
                const keys_to_copy = Object.keys(keys_sizes_map_to_copy);
                if (keys_to_copy.length) {
                    const copy_type = replication_utils.get_copy_type();
                    move_res = await replication_utils.move_objects(this._scanner_sem, this.client, copy_type, src_bucket.name,
                        dst_bucket.name, keys_to_copy);
                    console.log('replication_scanner: scan move_res: ', move_res);
                }

                await replication_store.update_log_replication_status_by_id(replication_id, Date.now());
            });
        }));
    }

    async head_buckets_and_compare(src_bucket, dst_bucket, candidates) {
        const keys_sizes_map_to_copy = {};

        // edge case 1: candidates = [] , nothing to replicate
        if (!candidates.Contents.length) return keys_sizes_map_to_copy;

        // head candidates in src_bucket and dst_bucket
        const src_dst_objects_list = await this.head_objects(src_bucket, dst_bucket, candidates);

        // edge case 1: src_head_map = {} , nothing to replicate
        if (!src_dst_objects_list.length) return keys_sizes_map_to_copy;

        for (let candidate of src_dst_objects_list) {

            // case 1: object not found in src
            if (!candidate.src_object_info) {
                continue;
            }

            // case 2: object not found in dst
            if (!candidate.dst_object_info) {
                keys_sizes_map_to_copy[candidate.key] = candidate.ContentLength;
                continue;
            }

            // case 3: object present both on the src and dst, need to check_data_or_md_change
            const should_copy = replication_utils.check_data_or_md_changed(candidate.src_object_info, candidate.dst_object_info);
            if (should_copy) {
                keys_sizes_map_to_copy[candidate.key] = candidate.ContentLength;
            }
        }
        return keys_sizes_map_to_copy;
    }

    async head_objects(src_bucket_name, dst_bucket_name, candidates) {
        const src_dst_objects_info = await P.all(_.map(candidates, async key => {
            try {
                dbg.log1('log_replication_scanner head_object: params:', src_bucket_name, key);

                const src_dst_object_info = await P.all([await this.noobaa_connection.headObject({
                    Bucket: src_bucket_name.unwrap(),
                    Key: key
                }).promise(), await this.noobaa_connection.headObject({
                    Bucket: dst_bucket_name.unwrap(),
                    Key: key
                }).promise()]);

                dbg.log1('log_replication_scanner.head_object: finished successfully', src_dst_object_info);

                return { key: key, src_object_info: src_dst_object_info[0], dst_object_info: src_dst_object_info[1] };
            } catch (err) {
                dbg.error('log_replication_scanner.head_objects: error:', err);
                throw err;
            }
        }));

        return src_dst_objects_info;
    }
}
