/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const http_utils = require('../../util/http_utils');


async function send_bucket_op_logs(req, res) {
    if (req.params && req.params.bucket) {
        const bucket_info = await req.object_sdk.read_bucket_sdk_config_info(req.params.bucket);
        dbg.log2("read_bucket_sdk_config_info =  ", bucket_info);

        if (is_bucket_logging_enabled(bucket_info)) {
            dbg.log2("Bucket logging is enabled for Bucket : ", req.params.bucket);
            endpoint_bucket_op_logs(req.op_name, req, res, bucket_info);
        }
    }
}


function is_bucket_logging_enabled(source_bucket) {

    if (!source_bucket || !source_bucket.bucket_info.logging) {
        return false;
    }
    return true;
}

function endpoint_bucket_op_logs(op_name, req, res, source_bucket) {

    dbg.log2("Sending op logs for op name = ", op_name);
    // 1 - Get all the information to be logged in a log message.
    // 2 - Format it and send it to log bucket/syslog.
    const s3_log = get_bucket_log_record(op_name, source_bucket, req, res);
    dbg.log1("Bucket operation logs = ", s3_log);

}

function get_bucket_log_record(op_name, source_bucket, req, res) {

    const client_ip = http_utils.parse_client_ip(req);
    let status_code;
    if (res && res.statusCode) {
        status_code = res.statusCode;
    }
    const log = {
        op: req.method,
        bucket_owner: source_bucket.bucket_owner,
        source_bucket: req.params.bucket,
        object_key: req.originalUrl,
        log_bucket: source_bucket.bucket_info.logging.log_bucket,
        remote_ip: client_ip,
        request_uri: req.originalUrl,
        http_status: status_code,
        request_id: req.request_id
    };

    return log;
}


exports.is_bucket_logging_enabled = is_bucket_logging_enabled;
exports.endpoint_bucket_op_logs = endpoint_bucket_op_logs;
exports.get_bucket_log_record = get_bucket_log_record;
exports.send_bucket_op_logs = send_bucket_op_logs;

