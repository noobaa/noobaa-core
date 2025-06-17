/* Copyright (C) 2023 NooBaa */
'use strict';

const _ = require('lodash');
const { S3 } = require('@aws-sdk/client-s3');

const SensitiveString = require('../../util/sensitive_string');
const replication_utils = require('../utils/replication_utils');
const dbg = require('../../util/debug_module')(__filename);

class BucketDiff {

    /**
     * @param {{
     *   first_bucket: string;
     *   second_bucket: string;
     *   version: boolean;
     *   s3_params?: object;
     *   connection?: import('@aws-sdk/client-s3').S3;
     *   for_replication: boolean;
     *   for_deletion: boolean;
     * }} params
     */
    constructor(params) {
        const {
            first_bucket,
            second_bucket,
            version,
            s3_params,
            connection,
            for_replication,
            for_deletion,
        } = params;
        this.first_bucket = first_bucket;
        this.second_bucket = second_bucket;
        this.version = version;
        //We will assume at this stage that first_bucket and second_bucket are accessible via the same s3
        // If we want to do a diff on none s3 we should use noobaa namespace buckets.
        if (connection) {
            this.s3 = connection;
        } else {
            if (!s3_params) throw new Error('Expected s3_params');
            this.s3 = new S3(s3_params);
        }
        // special treatment when we want the diff for replication purpose.
        this.for_replication = for_replication;
        // will set the bucket diff to return only the diff of delete markers.
        this.for_deletion = for_deletion;
    }

    /**
     * @param {{ 
     *   prefix: string;
     *   max_keys: number;
     *   current_first_bucket_cont_token: string;
     *   current_second_bucket_cont_token: string;
     * }} params
     */
    async get_buckets_diff(params) {
        const {
            prefix,
            max_keys,
            current_first_bucket_cont_token,
            current_second_bucket_cont_token,
        } = params;

        const diff = {
            // keys_diff_map is {{ [key: string]: Array<object> }} where the Array consist of metadata objects.
            // for example(disabled for_deletion): {
            //     "1": [
            //         { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
            //         { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, }
            //     ]
            // }
            //
            // for example(enabled for_deletion): {
            //     "1": [
            //         { Key: '1', VersionId: "v1.2", IsLatest: true, LastModified: '2022-02-27T10:45:00.000Z', },
            //         { Key: '1', VersionId: "v1.1", IsLatest: false, LastModified: '2022-01-27T10:45:00.000Z', }
            //     ]
            // }
            keys_diff_map: {},
            first_bucket_cont_token: '',
            second_bucket_cont_token: '',
        };

        let first_bucket_contents_left;
        let first_bucket_cont_token;
        //list the objects in the first bucket
        ({
            bucket_contents_left: first_bucket_contents_left,
            bucket_cont_token: first_bucket_cont_token
        } = await this.get_objects(this.first_bucket, prefix, max_keys, current_first_bucket_cont_token));

        if (first_bucket_cont_token) diff.first_bucket_cont_token = first_bucket_cont_token;
        if (Object.keys(first_bucket_contents_left).length === 0) return diff;

        let second_bucket_contents_left;
        let second_bucket_cont_token;
        let new_second_bucket_cont_token = current_second_bucket_cont_token;
        let keep_listing_second_bucket = true;

        while (keep_listing_second_bucket) {
            ({
                bucket_contents_left: second_bucket_contents_left,
                bucket_cont_token: new_second_bucket_cont_token
            } = await this.get_objects(this.second_bucket, prefix, max_keys, new_second_bucket_cont_token));

            const keys_diff_response = await this.get_keys_diff(
                first_bucket_contents_left, second_bucket_contents_left, new_second_bucket_cont_token);

            first_bucket_contents_left = keys_diff_response.keys_contents_left;
            keep_listing_second_bucket = keys_diff_response.keep_listing_second_bucket;
            diff.keys_diff_map = { ...diff.keys_diff_map, ...keys_diff_response.keys_diff_map };

            const first_bucket_key_array = Object.keys(first_bucket_contents_left);
            const second_bucket_key_array = Object.keys(second_bucket_contents_left);

            if (first_bucket_key_array.length !== 0 && second_bucket_key_array.length !== 0) {
                const first_bucket_key_in_last_pos = first_bucket_key_array[first_bucket_key_array.length - 1];
                const second_bucket_key_in_last_pos = second_bucket_key_array[second_bucket_key_array.length - 1];
                if (first_bucket_key_in_last_pos >= second_bucket_key_in_last_pos) {
                    second_bucket_cont_token = new_second_bucket_cont_token;
                }
            }
        }

        diff.second_bucket_cont_token = (first_bucket_cont_token && second_bucket_cont_token) ? new_second_bucket_cont_token : '';
        dbg.log2('BucketDiff get_buckets_diff', diff);
        return diff;
    }

    /**
     * @param {any} bucket_name
     * @param {string} prefix
     * @param {number} max_keys
     * @param {string} continuation_token
     */
    async _list_objects(bucket_name, prefix, max_keys, continuation_token) {
        dbg.log1('BucketDiff _list_objects::', bucket_name, prefix, max_keys, continuation_token);
        if (bucket_name instanceof SensitiveString) bucket_name = bucket_name.unwrap();
        try {
            const params = {
                Bucket: bucket_name,
                Prefix: prefix,
                MaxKeys: max_keys
            };
            if (this.version) {
                params.KeyMarker = continuation_token;
                return await this.s3.listObjectVersions(params);
            } else {
                if (continuation_token) params.ContinuationToken = continuation_token;
                return await this.s3.listObjectsV2(params);
            }
        } catch (err) {
            dbg.error('BucketDiff _list_objects: error:', err);
            throw err;
        }
    }

    /**
     * @param { import("@aws-sdk/client-s3").ListObjectVersionsOutput | import("@aws-sdk/client-s3").ListObjectsV2Output} list
     * 
     * _object_grouped_by_key_and_omitted will return the objects grouped by key.
     * When we have versioning enabled, if there is more than one key, it omits 
     * the last key from the object, in order to avoid processing incomplete list of object + version
     * 
     * the results of this will be {{ [key: string]: Array<object> }} where the Array consist of metadata objects.
     *       for example: {
     *            "1": [
     *                { ETag: 'etag1.1', Size: 24599, Key: '1', VersionId: 'v1.1', IsLatest: true, },
     *                { ETag: 'etag1.2', Size: 89317, Key: '1', VersionId: 'v1.2', IsLatest: false, }
     *            ]
     *        }
     * @returns {nb.BucketDiffKeysDiff}
     */
    _object_grouped_by_key_and_omitted(list) {
        // will return empty in two cases
        // case 1: if the list is empty
        if (!list) return {};
        // case 2: if we are fetching for delete markers but versioning is not enabled
        if (this.for_deletion && !this.version) {
            throw new Error("Invalid buckets: versioning not enabled for delete replications");
        }
        dbg.log1('_object_grouped_by_key_and_omitted list:', list);
        let field = this.version ? "Versions" : "Contents";
        if (this.for_deletion) {
            field = "DeleteMarkers";
        }
        let grouped_by_key = _.groupBy(list[field], "Key");
        // We should not omit if this is a list object and not list versions
        // and the use of continuation token later on the road will lead us to skip the last key if omitted.
        if (list.IsTruncated && this.version) {
            const last_key_pos = list[field].length - 1;
            if (Object.keys(grouped_by_key).length > 1) {
                grouped_by_key = _.omit(grouped_by_key, list[field][last_key_pos].Key);
            }
        }
        return grouped_by_key;
    }

    /**
     * @param {_.Dictionary<any[]>} list 
     * 
     * @param { import("@aws-sdk/client-s3").ListObjectVersionsOutput | import("@aws-sdk/client-s3").ListObjectsV2Output } list_objects_response
     * if the list is truncated on a version list, returns the the next key marker as the last key in the omitted objects list
     * if it is a list without versions, return NextContinuationToken.
     */
    _get_next_key_marker(list_objects_response, list) {
        if (this.version) return list_objects_response.IsTruncated ? Object.keys(list)[Object.keys(list).length - 1] : '';
        return list_objects_response.NextContinuationToken;
    }

    /**
     * @param {string} bucket
     * @param {string} prefix
     * @param {number} max_keys
     * @param {string} curr_bucket_cont_token
     * 
     * get_objects will get a bucket and parameters and return the object we want to work on and the continuation token
     * 
     */
    async get_objects(bucket, prefix, max_keys, curr_bucket_cont_token) {
        dbg.log2('BucketDiff get_objects::', bucket, prefix, max_keys, this.version, curr_bucket_cont_token);
        const list_objects_response = await this._list_objects(bucket, prefix, max_keys, curr_bucket_cont_token);
        if (!list_objects_response) return { bucket_contents_left: {}, bucket_cont_token: '' };
        dbg.log2('BucketDiff get_objects:: bucket_response', list_objects_response);
        const bucket_contents_left = this._object_grouped_by_key_and_omitted(list_objects_response);
        const bucket_cont_token = this._get_next_key_marker(list_objects_response, bucket_contents_left);
        dbg.log2('BucketDiff get_objects:: bucket', bucket, 'bucket_contents_left', bucket_contents_left);
        return { bucket_contents_left, bucket_cont_token };
    }

    /**
     * @param {any} first_bucket_keys
     * @param {nb.BucketDiffKeysDiff} second_bucket_keys
     * @param {string} second_bucket_cont_token
     * 
     * get_keys_version_diff finds the object keys and versions that the first bucket contains but second bucket doesn't
     */
    async get_keys_diff(first_bucket_keys, second_bucket_keys, second_bucket_cont_token) {
        const ans = {
            keys_diff_map: {},
            keys_contents_left: first_bucket_keys,
            keep_listing_second_bucket: false,
        };

        const stop_compare = this._process_keys_out_of_range(ans, second_bucket_keys);
        if (stop_compare) return ans;

        await this._process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token);

        return ans;
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket?: boolean; }} ans
     * @param {{}} second_bucket_keys
     */
    _process_keys_out_of_range(ans, second_bucket_keys) {
        const first_bucket_key_array = Object.keys(ans.keys_contents_left);
        const first_bucket_key_in_last_pos = first_bucket_key_array[first_bucket_key_array.length - 1];
        const second_bucket_key_array = Object.keys(second_bucket_keys);
        let stop_compare = false;

        // second bucket list is empty or all keys in first bucket are lexicographic smaller
        if (!Object.keys(second_bucket_key_array).length || first_bucket_key_in_last_pos < second_bucket_key_array[0]) {
            ans.keys_diff_map = { ...ans.keys_diff_map, ...ans.keys_contents_left };
            ans.keys_contents_left = {};
            stop_compare = true;
        }

        return stop_compare;
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket: boolean; }} ans
     * @param {nb.BucketDiffKeysDiff} second_bucket_keys
     * @param {string} second_bucket_cont_token
     */
    async _process_keys_in_range(ans, second_bucket_keys, second_bucket_cont_token) {
        const first_bucket_key_array = Object.keys(ans.keys_contents_left);
        const second_bucket_key_array = Object.keys(second_bucket_keys);
        const second_bucket_key_in_last_pos = second_bucket_key_array[second_bucket_key_array.length - 1];

        // Checking lexicographic order keys
        for (const cur_first_bucket_key of first_bucket_key_array) {

            // case 1:
            if (cur_first_bucket_key > second_bucket_key_in_last_pos) {
                this._keep_listing_or_return_ans(ans, second_bucket_cont_token);
                return ans;
            }

            const first_bucket_curr_obj = ans.keys_contents_left[cur_first_bucket_key];

            // case 2: 
            if (cur_first_bucket_key < second_bucket_key_array[0]) {
                this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
                continue;
            }

            // case 3: both key lists, from first bucket and from the second bucket are in the same range 
            const second_bucket_curr_obj = second_bucket_keys[cur_first_bucket_key];

            if (!this.for_deletion && second_bucket_curr_obj) { // for replication
                // get the positions of the etag in the first bucket for the same key name.
                let should_continue;
                // We will get the first etag on the second bucket to check if and where it is on the first bucket to determine what is the diff.
                let etag_pos_on_first_bucket = this._get_etag_pos(0, second_bucket_curr_obj, first_bucket_curr_obj);

                // no index, ETag is not in the first bucket:
                if (etag_pos_on_first_bucket.length === 0) {
                    ({ should_continue, etag_pos_on_first_bucket } = this._etag_not_in_first_bucket(
                        ans, etag_pos_on_first_bucket, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj));
                    if (should_continue) continue;
                }

                // if there is one index then: 
                //     pos 0 Etag is on the latest, we just need to omit this key
                //     n > 0  all n are diff.    
                // if there is more then one index then:
                //    We took the decision that it will act as only one Etag, if we will want to reevaluate it we can do:
                //    if it is consecutive we treat it as one, 
                //    if it is not we search the earliest intersection, and assume the diff from it.
                // as we treat it as one we open a Gap:
                // The ETags are the same but it is not ensuring that the metadata is also the same
                // Gap: we might want to go over all of the same ETags and check for each version if the metadata is the same. 
                //      currently we choose to treat multiple same Etag as the same object and slice to the latest we found. 
                if (etag_pos_on_first_bucket.length >= 1) {
                    const pos = etag_pos_on_first_bucket[0];
                    if (pos > 0) { // can happen only in version
                        const same_md = await this._is_same_user_metadata(
                            pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
                        if (same_md) {
                            const first_bucket_diff = first_bucket_curr_obj.slice(0, pos);
                            ans.keys_diff_map[cur_first_bucket_key] = first_bucket_diff;
                        } else {
                            this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
                        }
                    } else {
                        // We will check if the metadata is the same. if it is not then it is a diff.
                        dbg.log1('The same file with the same ETag found in both buckets on the latest versions', second_bucket_curr_obj);
                        const same_md = await this._is_same_user_metadata(
                            0, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
                        if (!same_md) this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
                    }
                }
                ans.keys_contents_left = _.omit(ans.keys_contents_left, cur_first_bucket_key);
                continue;
            } else if (this.for_deletion && second_bucket_curr_obj) { // for deletion
                const latest_delete_marker_first = this._get_latest_delete_marker(first_bucket_curr_obj);
                const latest_delete_marker_second = this._get_latest_delete_marker(second_bucket_curr_obj);
                // There is only one case where we need to update keys_diff_map,
                // when there is latest delete marker found in first bucket but not in second bucket
                if (latest_delete_marker_first && !latest_delete_marker_second) {
                    this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
                }
                ans.keys_contents_left = _.omit(ans.keys_contents_left, cur_first_bucket_key);
                continue;
            } else { //This is when there is no such key name on the second bucket in this range.
                this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
            }
        }
        return ans;
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket: any; }} ans
     * @param {string} second_bucket_cont_token
     */
    _keep_listing_or_return_ans(ans, second_bucket_cont_token) {
        if (second_bucket_cont_token) {
            ans.keep_listing_second_bucket = true;
        } else {
            ans.keys_diff_map = { ...ans.keys_diff_map, ...ans.keys_contents_left };
            ans.keys_contents_left = {};
        }
        dbg.log1('_keep_listing_or_return_ans: ', second_bucket_cont_token, ans);
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket: boolean; }} ans
     * @param {string | any[]} etag_pos_on_first_bucket
     * @param {string} cur_first_bucket_key
     * @param {any[]} first_bucket_curr_obj
     * @param {any[]} second_bucket_curr_obj
     */
    _etag_not_in_first_bucket(ans, etag_pos_on_first_bucket, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj) {
        let pos = 0;
        let should_continue = false;
        dbg.log1('ETag is not in the first bucket', etag_pos_on_first_bucket);
        //     Version: someone wrote directly to the second bucket. need to drill down on the second bucket to see comparison. 
        //              or the first bucket have a list of max keys and all the keys versions there are newer (with different etag).
        if (this.version) {
            //We will need to drill down on the position of the etag in the second_bucket_curr_obj
            while (etag_pos_on_first_bucket.length === 0 && pos < second_bucket_curr_obj.length) {
                pos += 1;
                etag_pos_on_first_bucket = this._get_etag_pos(pos, second_bucket_curr_obj, first_bucket_curr_obj);
            }
            // If non of the ETags of this object exists in the first bucket all the versions are diff.
            if (etag_pos_on_first_bucket.length === 0 && pos >= second_bucket_curr_obj.length) {
                // Gap: this is not accurate, if only several versions are newer in the destination, then *some* need to be replicated.
                //      for now, we will take an assumption that when the latest in the destination is newer we should not consider as diff.
                this._check_last_modified_for_replication(ans, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
                should_continue = true;
            }
        } else { // in non version flow - if the second bucket key etag is not the same as the first bucket key etag - this is a diff.
            // in replication we want to replicate only if the object in the first bucket is more recent then the one in the second bucket
            this._check_last_modified_for_replication(ans, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj);
            should_continue = true;
        }
        return { should_continue, etag_pos_on_first_bucket };
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket: boolean; }} ans
     * @param {string} cur_bucket_key
     * @param {any} bucket_curr_obj
     */
    _populate_diff_map_and_omit_contents_left(ans, cur_bucket_key, bucket_curr_obj) {
        ans.keys_diff_map[cur_bucket_key] = bucket_curr_obj;
        ans.keys_contents_left = _.omit(ans.keys_contents_left, cur_bucket_key);
    }

    /**
     * @param {{ keys_diff_map: nb.BucketDiffKeysDiff; keys_contents_left: any; keep_listing_second_bucket: boolean; }} ans
     * @param {string} cur_first_bucket_key
     * @param {any[]} first_bucket_curr_obj
     * @param {any[]} second_bucket_curr_obj
     */
    _check_last_modified_for_replication(ans, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj) {
        // In the case that we use the diff for replication, we dont want to consider a diff on if the latest version in the
        //    second bucket (destination) is newer.
        if (this.for_replication && first_bucket_curr_obj[0].LastModified < second_bucket_curr_obj[0].LastModified) {
            ans.keys_contents_left = _.omit(ans.keys_contents_left, cur_first_bucket_key);
        } else {
            this._populate_diff_map_and_omit_contents_left(ans, cur_first_bucket_key, first_bucket_curr_obj);
        }
    }

    /**
     * @param {number} pos
     * @param {string} cur_first_bucket_key
     * @param {any[]} first_bucket_curr_obj
     * @param {any[]} second_bucket_curr_obj
     */
    async _is_same_user_metadata(pos, cur_first_bucket_key, first_bucket_curr_obj, second_bucket_curr_obj) {
        let first_bucket_obj_version_id;
        let second_bucket_obj_version_id;
        if (this.version) {
            first_bucket_obj_version_id = first_bucket_curr_obj[pos].VersionId;
            second_bucket_obj_version_id = second_bucket_curr_obj[0].VersionId;
        }

        const [first_bucket_curr_obj_metadata, second_bucket_curr_obj_metadata] = await Promise.all([
            replication_utils.get_object_md(this.first_bucket, cur_first_bucket_key, this.s3, first_bucket_obj_version_id),
            replication_utils.get_object_md(this.second_bucket, cur_first_bucket_key, this.s3, second_bucket_obj_version_id),
        ]);

        const first_bucket_curr_obj_user_metadata = first_bucket_curr_obj_metadata?.Metadata;
        const second_bucket_curr_obj_user_metadata = second_bucket_curr_obj_metadata?.Metadata;
        return _.isEqual(first_bucket_curr_obj_user_metadata, second_bucket_curr_obj_user_metadata);

    }



    /**
     * @param {number} pos
     * @param {any[]} first_obj
     * @param {any[]} second_obj
     */
    _get_etag_pos(pos, first_obj, second_obj) {
        // Getting the etag of first_obj is the position asked. 
        if (!first_obj[pos]) return [];
        const ETag = first_obj[pos].ETag;
        const target_pos = second_obj.reduce((indexes, obj, index) => {
            if (obj.ETag === ETag) {
                indexes.push(index);
            }
            return indexes;
        }, []);
        return target_pos;
    }

    /**
     * @param {any[]} bucket_obj
     */
    _get_latest_delete_marker(bucket_obj) {
        // return true if latest delete marker found or else false otherwise
        return bucket_obj.some(obj => obj.IsLatest);
    }

}
exports.BucketDiff = BucketDiff;
