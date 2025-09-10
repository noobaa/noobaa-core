/* Copyright (C) 2016 NooBaa */
'use strict';

const system_store = require('../system_services/system_store').get_instance();
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const config = require('../../../config');
const cloud_utils = require('../../util/cloud_utils');
const fs = require('fs');
const { export_logs_to_target } = require('../../util/bucket_logs_utils');
const { get_process_fs_context } = require('../../util/native_fs_utils');
const RpcError = require('../../rpc/rpc_error');

const BUCKET_LOGS_PATH = '/log/noobaa_bucket_logs/';

// delimiter between bucket name and log object name.
// Assuming noobaa bucket name follows the s3 bucket
// naming rules and can not have "_" in its name.
// https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html

const BUCKET_NAME_DEL = "_";
class BucketLogUploader {

    /**
     * @param {{
     *   name: string;
     *   client: nb.APIClient;
     * }} params
     */
    constructor({ name, client }) {
        this.name = name;
        this.client = client;
        this.noobaa_connection = undefined;
    }

    async scan() {
        dbg.log0('Running scanner for bucket log objects');
        if (!this.noobaa_connection) {
            throw new Error('noobaa endpoint connection is not started yet...');
        }
        if (config.BUCKET_LOG_TYPE === 'PERSISTENT') {
            const fs_context = get_process_fs_context();
            const success = await export_logs_to_target(fs_context, () => this.noobaa_connection, this.get_bucket_owner_keys);
            if (success) {
                dbg.log0('Logs were uploaded succesfully to their target buckets');
            } else {
                dbg.error('Logs upload failed - will retry in the next cycle');
            }
        } else {
            await this.get_and_upload_bucket_log();
        }
    }

    async run_batch() {
        if (!this._can_run()) return;
        dbg.log0('Scaning bucket logging objects in ', BUCKET_LOGS_PATH);
        try {
            if (!this.noobaa_connection) {
                this.noobaa_connection = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
            }
            await this.scan();
        } catch (err) {
            dbg.error('Could not setup noobaa connection :', err);
        }

        return config.BUCKET_LOG_UPLOADER_DELAY;
    }

    _can_run() {

        if (!system_store.is_finished_initial_load) {
            dbg.log0('system_store did not finish initial load');
            return false;
        }
        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    /**
     * Fetch the name of buckets from log object
     * and creates list of buckets and respective log objects
     * @param {Array} log_objects The list of log objects.
     * @return {Array} The list of bucket names and respective log objects.
     */
    _get_buckets_and_objects_list(log_objects) {
        const buckets = [];
        if (!log_objects) return buckets;
        for (const file of log_objects) {
            const source_bucket_name = file.split(BUCKET_NAME_DEL)[0];
            const log_bucket_name = file.split(BUCKET_NAME_DEL)[1];
            const source_bucket = system_store.data.buckets.find(bucket => bucket.name.unwrap() === source_bucket_name);
            const log_bucket = system_store.data.buckets.find(bucket => bucket.name.unwrap() === log_bucket_name);
            buckets.push({
                source_bucket_name: source_bucket_name,
                log_bucket_name: log_bucket_name,
                source_bucket: source_bucket,
                log_bucket: log_bucket,
                log_object_name: file,
            });
        }
        return buckets;
    }

    /**
     * Deletes the log object after uploading
     * it to log bucket.
     * @param string log_file_path The list of log objects.
     */
    _delete_bucket_log_entries(log_file_path) {
        if (log_file_path) {
            dbg.log0('Deleting log object: ', log_file_path);
            try {
                fs.unlinkSync(log_file_path);
            } catch (err) {
                dbg.error('Could not delete log object: ', log_file_path);
            }
        }
    }

    /**
     * Uploades the log object to the log bucket
     * @param {Object} log_object The log object
     * containing log records for the bucket.
     */
    async upload_bucket_log_objects(log_object) {
        dbg.log0('Uploading bucket log: ', log_object.log_object_name, ' to log bucket: ', log_object.log_bucket_name);

        if (!log_object.source_bucket || log_object.source_bucket.deleting || !log_object.source_bucket.logging) {
            throw new Error('Source Bucket does not exist or logging is not configured');
        }
        if (!log_object.log_bucket || log_object.log_bucket.deleting) {
            throw new Error('Log Bucket does not exist or being deleted');
        }

        const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
        if (!noobaa_con) {
            throw new Error('noobaa endpoint connection is not started yet...');
        }

        const log_object_key = log_object.source_bucket.logging.log_prefix + log_object.log_object_name;
        const log_file_path = BUCKET_LOGS_PATH + log_object.log_object_name;
        const params = {
            Bucket: log_object.log_bucket_name,
            Key: log_object_key,
            Body: fs.readFileSync(log_file_path),
        };

        try {
            await noobaa_con.putObject(params);
        } catch (err) {
            dbg.error('Failed to upload bucket log object: ', log_object.log_object_name, ' to bucket: ', log_object.log_bucket_name, ' :', err);
        }
    }

    /**
    * Read the directory BUCKET_LOGS_PATH
    * and get the list of all log objects. After getting
    * name of the bucket it uploades the log objects to the log bucket
    * and creates list of buckets and respective log objects.
    **/
    async get_and_upload_bucket_log() {
        let log_objects;
        let log_file_path;

        if (!fs.existsSync(BUCKET_LOGS_PATH)) {
            dbg.error('Log directory does not exist:', BUCKET_LOGS_PATH);
            return;
        }
        try {
            log_objects = fs.readdirSync(BUCKET_LOGS_PATH);
        } catch (err) {
            dbg.error('Failed to read directory:', BUCKET_LOGS_PATH, ':', err);
        }
        dbg.log0('Found log objects: ', log_objects);
        const buckets_and_log_objects = this._get_buckets_and_objects_list(log_objects);
        if (buckets_and_log_objects.length > 0) {
            for (const log_object of buckets_and_log_objects) {
                try {
                    await this.upload_bucket_log_objects(log_object);
                } catch (err) {
                    dbg.error('Failed to upload bucket log object: ', log_object.log_object_name, ' to bucket: ', log_object.log_bucket_name, ' :', err);
                } finally {
                    log_file_path = BUCKET_LOGS_PATH + log_object.log_object_name;
                    this._delete_bucket_log_entries(log_file_path);
                }
            }
        }
    }

    async get_bucket_owner_keys(bucket_name) {
        const bucket = system_store.data.systems[0].buckets_by_name[bucket_name];
        if (!bucket) {
            dbg.error('BUCKET NOT FOUND', bucket_name);
            throw new RpcError('NO_SUCH_BUCKET', 'No such bucket: ' + bucket_name);
        }
        return [{
            access_key: bucket.owner_account.access_keys[0].access_key.unwrap(),
            secret_key: bucket.owner_account.access_keys[0].secret_key.unwrap(),
        }];
    }
}

exports.BucketLogUploader = BucketLogUploader;
