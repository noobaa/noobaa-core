/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const stream = require('stream');
const crypto = require('crypto');
const path = require('path');
const { PersistentLogger, LogFile } = require('../util/persistent_logger');
const { format_aws_date } = require('../util/time_utils');
const nsfs_schema_utils = require('../manage_nsfs/nsfs_schema_utils');
const semaphore = require('../util/semaphore');
const P = require('../util/promise');
const nb_native = require('../util/nb_native');
const AWS = require('aws-sdk');

const sem = new semaphore.Semaphore(config.BUCKET_LOG_CONCURRENCY);

// delimiter between bucket name and log object name.
// Assuming noobaa bucket name follows the s3 bucket
// naming rules and can not have "_" in its name.
// https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html

const BUCKET_NAME_DEL = "_";

/**
 * This function will process the persistent log of bucket logging
 * and will upload the log files in using provided noobaa connection
 * @param {nb.NativeFSContext} fs_context
 * @param {AWS.S3} s3_connection
 * @param {function} bucket_to_owner_keys_func
 */
async function export_logs_to_target(fs_context, s3_connection, bucket_to_owner_keys_func) {
    const entries = await nb_native().fs.readdir(fs_context, config.PERSISTENT_BUCKET_LOG_DIR);
    const results = await P.map_with_concurrency(5, entries, async entry => {
        if (!entry.name.endsWith('.log')) return;
        const log = new PersistentLogger(config.PERSISTENT_BUCKET_LOG_DIR, path.parse(entry.name).name, { locking: 'EXCLUSIVE' });
        try {
            return log.process(async file => _upload_to_targets(fs_context, s3_connection, file, bucket_to_owner_keys_func));
        } catch (err) {
            dbg.error('processing log file failed', log.file);
            throw err;
        } finally {
            await log.close();
        }
    });
    return !results.includes(false);
}

/**
 * This function gets a persistent log file, will go over it's entries one by one,
 * and will upload the entry to the target_bucket using the provided s3 connection
 * in order to know which user to use to upload to each bucket we will need to provide bucket_to_owner_keys_func
 * @param {nb.NativeFSContext} fs_context
 * @param {AWS.S3} s3_connection
 * @param {string} log_file
 * @param {function} bucket_to_owner_keys_func
 * @returns {Promise<Boolean>}
 */
async function _upload_to_targets(fs_context, s3_connection, log_file, bucket_to_owner_keys_func) {
    const bucket_streams = {};
    const promises = [];
    try {
        const file = new LogFile(fs_context, log_file);
        dbg.log1('uploading file to target buckets', log_file);
        await file.collect_and_process(async entry => {
            const log_entry = JSON.parse(entry);
            nsfs_schema_utils.validate_log_schema(log_entry);
            const target_bucket = log_entry.log_bucket;
            const log_prefix = log_entry.log_prefix;
            const source_bucket = log_entry.source_bucket;
            if (!bucket_streams[source_bucket + BUCKET_NAME_DEL + target_bucket]) {
                /* new stream is needed for each target bucket, but also for each source bucket
                           - as mulitple buckets can't be written to the same object */
                const date = new Date();
                const upload_stream = new stream.PassThrough();
                let access_keys;
                try {
                    access_keys = await bucket_to_owner_keys_func(target_bucket);
                } catch (err) {
                    dbg.warn('Error when trying to resolve bucket keys', err);
                    if (err.rpc_code === 'NO_SUCH_BUCKET') return; // If the log_bucket doesn't exist any more - nowhere to upload - just skip
                }
                s3_connection.config.credentials = new AWS.Credentials(access_keys[0].access_key, access_keys[0].secret_key);
                const sha = crypto.createHash('sha512').update(target_bucket + date.getTime()).digest('hex');
                promises.push(sem.surround(() => P.retry({
                    attempts: 3,
                    delay_ms: 1000,
                    func: () => s3_connection.upload({
                        Bucket: target_bucket,
                        Key: `${log_prefix}${format_aws_date(date)}-${sha.slice(0, 16).toUpperCase()}`,
                        Body: upload_stream,
                    }).promise()
                })));
                bucket_streams[source_bucket + BUCKET_NAME_DEL + target_bucket] = upload_stream;
            }
            dbg.log2(`uploading entry: ${entry} to target bucket: ${target_bucket}`);
            bucket_streams[source_bucket + BUCKET_NAME_DEL + target_bucket].write(entry + '\n');
        });
        Object.values(bucket_streams).forEach(st => st.end());
        await Promise.all(promises);
    } catch (error) {
        dbg.error('unexpected error in upload to bucket:', error, 'for:', log_file);
        return false;
    }
    return true;
}

exports.export_logs_to_target = export_logs_to_target;
