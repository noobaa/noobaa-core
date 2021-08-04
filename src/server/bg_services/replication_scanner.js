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
const auth_server = require('../common_services/auth_server');
const cloud_utils = require('../../util/cloud_utils');
const prom_reporting = require('../analytic_services/prometheus_reporting');


const PARTIAL_SINGLE_BUCKET_REPLICATION_DEFAULTS = {
    replication_id: '',
    last_cycle_rule_id: '',
    bucket_name: '',
    last_cycle_src_cont_token: '',
    last_cycle_writes_num: 0,
    last_cycle_writes_size: 0,
    last_cycle_error_writes_num: 0,
    last_cycle_error_writes_size: 0,
};

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
        this._scanner_sem = new Semaphore(config.REPLICATION_SEMAPHORE_CAP, {
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

            const { src_bucket, dst_bucket } = this.find_src_and_dst_buckets(rule.destination_bucket, replication_id);
            if (!src_bucket || !dst_bucket) {
                dbg.error('replication_scanner: can not find src_bucket or dst_bucket object', src_bucket, dst_bucket);
                return;
            }
            const prefix = (rule.filter && rule.filter.prefix) || '';
            const cur_src_cont_token = (rule.status && rule.status.src_cont_token) || '';
            const cur_dst_cont_token = (rule.status && rule.status.dst_cont) || '';

            const { keys_sizes_map_to_copy, src_cont_token, dst_cont_token } = await this.list_buckets_and_compare(src_bucket.name,
                dst_bucket.name, prefix, cur_src_cont_token, cur_dst_cont_token);

            dbg.log1('replication_scanner: keys_sizes_map_to_copy: ', keys_sizes_map_to_copy);
            let move_res;
            const keys_to_copy = Object.keys(keys_sizes_map_to_copy);
            if (keys_to_copy.length) {
                const copy_type = this._get_copy_type();
                move_res = await this.move_objects(copy_type, src_bucket.name, dst_bucket.name, keys_to_copy);
                console.log('replication_scanner: scan move_res: ', move_res);
            }

            await replication_store.update_replication_status_by_id(replication_id,
                rule.rule_id, {
                    ...status,
                    last_cycle_end: Date.now(),
                    src_cont_token,
                    dst_cont_token
                    // always advance the src cont token, if failures happened - they will eventually will be copied
                });

            const replication_status = this._get_rule_status(rule.rule_id,
                src_cont_token, keys_sizes_map_to_copy, move_res || []);

            this.update_replication_prom_report(src_bucket.name, replication_id, replication_status);
        }));
    }

    async list_buckets_and_compare(src_bucket, dst_bucket, prefix, cur_src_cont_token, cur_dst_cont_token) {

        // list src_bucket
        const src_list = await this.list_objects(src_bucket, prefix, cur_src_cont_token);
        const ans = {
            keys_sizes_map_to_copy: {},
            src_cont_token: src_list.NextContinuationToken || '',
            dst_cont_token: ''
        };

        // edge case 1: src list = [] , nothing to replicate
        if (!src_list.Contents.length) return ans;

        let src_contents_left = src_list.Contents;
        let new_dst_cont_token = cur_dst_cont_token;
        const last_src_key = src_list.Contents[src_list.Contents.length - 1].Key;

        let keep_listing_dst = true;
        while (keep_listing_dst) {
            const dst_list = await this.list_objects(dst_bucket, prefix, new_dst_cont_token);

            // edge case 2: dst list = [] , replicate all src_list
            // edge case 3: all src_keys are lexicographic smaller than the first dst key, replicate all src_list
            if (!dst_list.Contents.length || last_src_key < dst_list.Contents[0].Key) {
                ans.keys_sizes_map_to_copy = src_contents_left.reduce(
                    (acc, content1) => {
                        acc[content1.Key] = content1.Size;
                        return acc;
                    }, { ...ans.keys_sizes_map_to_copy });
                break;
            }

            // find keys to copy
            const diff = await this.get_keys_diff(src_contents_left, dst_list.Contents, dst_list.NextContinuationToken,
                src_bucket, dst_bucket);

            keep_listing_dst = diff.keep_listing_dst;
            src_contents_left = diff.src_contents_left;
            ans.keys_sizes_map_to_copy = { ...ans.keys_sizes_map_to_copy, ...diff.to_replicate_map };

            // advance dst token only when cur dst list could not contains next src list items
            const last_dst_key = dst_list.Contents[dst_list.Contents.length - 1].Key;
            if (last_src_key >= last_dst_key) {
                new_dst_cont_token = dst_list.NextContinuationToken;
            }
        }
        return {
            ...ans,
            // if src_list cont token is empty - dst_list cont token should be empty too
            dst_cont_token: (src_list.NextContinuationToken && new_dst_cont_token) || ''
        };
    }

    async move_objects(copy_type, src_bucket_name, dst_bucket_name, keys) {
        try {
            const res = await this._scanner_sem.surround_count(keys.length,
                async () => {
                    try {
                        const res1 = await this.client.replication.move_objects_by_type({
                            copy_type,
                            src_bucket_name,
                            dst_bucket_name,
                            keys
                        }, {
                            auth_token: auth_server.make_auth_token({
                                system_id: system_store.data.systems[0]._id,
                                account_id: system_store.data.systems[0].owner._id,
                                role: 'admin'
                            })
                        });
                        return res1;
                    } catch (err) {
                        // no need to do retries, eventually the object will be uploaded
                        // TODO: serious error codes with metrics (auth_failed, storage not exist etc)
                        dbg.error('replication_server move_objects: error: ', err, src_bucket_name, dst_bucket_name, keys);
                    }
                });
            return res;
        } catch (err) {
            dbg.error('replication_server move_objects: semaphore error:', err, err.stack);
            // no need to handle semaphore errors, eventually the object will be uploaded
        }
    }

    async list_objects(bucket_name, prefix, continuation_token) {
        try {
            dbg.log1('replication_server list_objects: params:', bucket_name, prefix, continuation_token);
            const list = await this.noobaa_connection.listObjectsV2({
                Bucket: bucket_name.unwrap(),
                Prefix: prefix,
                ContinuationToken: continuation_token,
                MaxKeys: Number(process.env.REPLICATION_MAX_KEYS) || 1000
            }).promise();

            dbg.log1('replication_server.list_objects: finished successfully', list.Contents.map(c => c.Key));
            return list;
        } catch (err) {
            dbg.error('replication_server.list_objects: error:', err);
            throw err;
        }
    }

    async get_object_md(bucket_name, key) {
        try {
            dbg.log1('replication_server get_object_md: params:', bucket_name.unwrap(), key);
            const head = await this.noobaa_connection.headObject({
                Bucket: bucket_name.unwrap(),
                Key: key,
            }).promise();

            dbg.log1('replication_server.get_object_md: finished successfully', head, head.Metadata);
            return head.Metadata;
        } catch (err) {
            dbg.error('replication_server.get_object_md: error:', err);
            throw err;
        }
    }

    async check_data_or_md_changed(cur_src_key, src_bucket_name, dst_bucket_name, src_content, dst_content) {
        // when object in dst bucket is more recent - we don't want to override it so we do not
        // execute replication of object
        const src_last_modified_recent = src_content.LastModified >= dst_content.LastModified;
        if (!src_last_modified_recent) return false;

        // data change - replicate the object
        const data_change = src_content.Size !== dst_content.Size || src_content.ETag !== dst_content.ETag;
        if (data_change) return true;

        // md change - head objects and compare metadata, if metadata is different - copy object
        const md_src = await this.get_object_md(src_bucket_name, cur_src_key);
        const md_dst = await this.get_object_md(dst_bucket_name, cur_src_key);
        dbg.log1('replication_server.check_data_or_md_changed md res:', md_src, md_dst);
        if (!_.isEqual(md_src, md_dst)) return true;

        // data and md is equal which means something else changed in src
        // nothing to do 
        return false;
    }

    _get_copy_type() {
        // TODO: get copy type by src and dst buckets (for server side/other optimization)
        return 'MIX';
    }

    // get_keys_diff finds the object keys that src bucket contains but dst bucket doesn't
    // iterate all src_keys and for each if:
    // case 1: src_key is lexicographic bigger than last dst_key,
    //         list dst from next cont token if exist, else - replicate all src keys
    // case 2: src_key is lexicographic smaller than first dst_key
    //         replicate src_key and continue the loop
    // case 3: src_key in dst list keys range - 
    // if src_key doesn't exist is dst_list or needs update - replicate, else do nothing; continue
    async get_keys_diff(src_keys, dst_keys, dst_next_cont_token, src_bucket_name, dst_bucket_name) {
        dbg.log1('replication_server.get_keys_diff: src contents', src_keys.map(c => c.Key), 'dst contents', dst_keys.map(c => c.Key));

        let to_replicate_map = {};
        const dst_map = _.keyBy(dst_keys, 'Key');

        for (let [i, src_content] of src_keys.entries()) {
            const cur_src_key = src_content.Key;
            dbg.log1('replication_server.get_keys_diff, src_key: ', i, cur_src_key);

            // case 1
            if (cur_src_key > dst_keys[dst_keys.length - 1].Key) {
                const src_contents_left = src_keys.slice(i);
                // in next iteration we shouldn't iterate again src keys we already passed
                const ans = dst_next_cont_token ? { to_replicate_map, keep_listing_dst: true, src_contents_left } : {
                    to_replicate_map: src_contents_left.reduce((acc, cur_obj) => {
                        acc[cur_obj.Key] = cur_obj.Size;
                        return acc;
                    }, { ...to_replicate_map })
                };
                dbg.log1('replication_server.get_keys_diff, case1: ', dst_next_cont_token, ans);
                return ans;
            }
            // case 2
            if (cur_src_key < dst_keys[0].Key) {
                dbg.log1('replication_server.get_keys_diff, case2: ', cur_src_key);
                to_replicate_map[cur_src_key] = src_content.Size;
                continue;
            }
            // case 3: src_key is in range
            const dst_content = dst_map[cur_src_key];
            dbg.log1('replication_server.get_keys_diff, case3: src_content', src_content, 'dst_content:', dst_content);
            if (dst_content) {
                const should_copy = await this.check_data_or_md_changed(cur_src_key, src_bucket_name, dst_bucket_name,
                    src_content, dst_content);
                if (should_copy) to_replicate_map[cur_src_key] = src_content.Size;
            } else {
                to_replicate_map[cur_src_key] = src_content.Size;
            }
        }
        dbg.log1('replication_server.get_keys_diff result:', to_replicate_map);
        return { to_replicate_map };
    }

    _get_rule_status(rule, src_cont_token, keys_sizes_map_to_copy, move_res) {
        const keys_to_copy_sizes = Object.values(keys_sizes_map_to_copy);
        const num_keys_to_copy = keys_to_copy_sizes.length || 0;
        const num_bytes_to_copy = num_keys_to_copy > 0 ? _.sum(keys_to_copy_sizes) : 0;

        const num_keys_moved = move_res.length || 0;
        const num_bytes_moved = num_keys_moved > 0 ? _.sumBy(move_res, itm => keys_sizes_map_to_copy[itm]) : 0;

        const status = {
            last_cycle_rule_id: rule,
            last_cycle_src_cont_token: src_cont_token,
            last_cycle_writes_num: num_keys_moved,
            last_cycle_writes_size: num_bytes_moved,
            last_cycle_error_writes_num: num_keys_to_copy - num_keys_moved,
            last_cycle_error_writes_size: num_bytes_to_copy - num_bytes_moved,
        };
        dbg.log0('_get_rule_status: ', status);
        return status;
    }

    find_src_and_dst_buckets(dst_bucket_id, replication_id) {
        const ans = _.reduce(system_store.data.buckets, (acc, cur_bucket) => {
            dbg.log1('find_src_and_dst_buckets1: ', cur_bucket._id, dst_bucket_id, cur_bucket.replication_policy_id, replication_id);
            if (cur_bucket._id.toString() === dst_bucket_id.toString()) acc.dst_bucket = cur_bucket;
            if (cur_bucket.replication_policy_id &&
                (cur_bucket.replication_policy_id.toString() === replication_id.toString())) {
                acc.src_bucket = cur_bucket;
            }
            return acc;
        }, { src_bucket: undefined, dst_bucket: undefined });

        return ans;
    }

    update_replication_prom_report(bucket_name, replication_policy_id, replication_status) {
        const core_report = prom_reporting.get_core_report();
        const last_cycle_status = _.defaults({
            ...replication_status,
            bucket_name: bucket_name.unwrap(),
            replication_id: replication_policy_id
        }, PARTIAL_SINGLE_BUCKET_REPLICATION_DEFAULTS);

        core_report.set_replication_status(last_cycle_status);
    }
}

exports.ReplicationScanner = ReplicationScanner;
