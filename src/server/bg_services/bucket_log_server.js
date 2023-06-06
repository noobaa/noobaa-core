/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const P = require('../../util/promise');
const cloud_utils = require('../../util/cloud_utils');
const { get_bucket_info } = require('../system_services/bucket_server');

/**
 * create_log_object takes collection of log records, arrange it and
 * writes it in log object on a given log bucket. 
 * @param {*} req request object
 * req should contain two fields/info
 * 1 - source_bucket - Bucket on which operation has been done and
 * configured for bucket logging.
 * 2 - logs - This is the collection of log records of different object operations on 
 * source_bucket. Could be an array of log records. 
 *
 * Steps -  
 * 1 - Sort log records and the create a text with each record ends with new line
 * 2 - Find out the respective log bucket for the log records. "req" will have the name of the "source bucket". 
 *     We would need to find out the configuration of this bucket so that we can see if the logging is enabled
 *     or not. We can also find out the configured "log bucket" of this "source bucket" configured by user.
 * 3 - Configuration will also have the prefix which can be used in log object naming.
 * 4 - Create a S3 client using which we can send the putObject call to log bucket.
 */

async function get_log_bucket_and_prefix(source_bucket) {
    const bucket_info = get_bucket_info(source_bucket);
    return { bucket_info.log_bucket, bucket_info.log_prefix };
}

async function sort_and_arrange_log_records(logs) {


}

async function put_bucket_log_object(param) {
    const { source_bucket, logs } = param.rpc_params;
    dbg.log1('bucket_log_server create_log_objects for:', source_bucket);

    const { log_bucket, prefix } = get_log_bucket_and_prefix(source_bucket);
    const object_key = prefix + Date.now(); // Use a timestamp as the object key

    log_records = sort_and_arrange_log_records(logs);

    const log_object = {
        Bucket: log_bucket,
        Key: object_key,
        Body: log_records.join('\n') // Join log records with newlines
    };

    try {
        const noobaa_con = cloud_utils.set_noobaa_s3_connection(system_store.data.systems[0]);
        if (!noobaa_con) {
            throw new Error('Noobaa endpoint connection is not available');
        }

        const data = await noobaa_con.putObject(log_object).promise();
        console.log('Log records have been written:', data);
    } catch (err) {
        console.error('Could not write log object:', err);
        throw err;
    }
}

exports.put_bucket_log_object = put_bucket_log_object;
