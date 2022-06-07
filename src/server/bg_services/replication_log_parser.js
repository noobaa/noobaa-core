/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const saw = require('string-saw');
const moment = require('moment');
const system_store = require('../system_services/system_store').get_instance();
const cloud_utils = require('../../util/cloud_utils');
const http_utils = require('../../util/http_utils');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');

const AWS_ACCESS_LOG_REGEXP = /(?:([a-z0-9]+)|-) (?:-|([a-z0-9.\-_]+)) (?:\[([^\]]+)\]|-) (?:([0-9.]+)|-) (?:-|([a-z0-9:/-]+)) (?:([a-z0-9.-_]+)|-) (?:([a-z.]+)|-) (?:-|([a-z0-9.\-_/%]+)) (?:"-"|"([^"]+)"|-) (?:(\d+)|-) (?:([a-z]+)|-) (?:(\d+)|-) (?:(\d+)|-) (?:(\d+)|-) (?:(\d+)|-) (?:"-"|"([^"]+)"|-) (?:"-"|"([^"]+)"|-) (?:([a-z0-9]+)|-)/i;

async function get_log_candidates(source_bucket_id, replicationconfig, candidates_limit) {
    if (replicationconfig.aws_log_replication_info) {
        return get_aws_log_candidates(source_bucket_id, replicationconfig.aws_log_replication_info, candidates_limit);
    }
}

async function get_aws_log_candidates(source_bucket_id, aws_log_replication_info, candidates_limit) {
    const { logs_bucket, logs_prefix, continuation_token } = aws_log_replication_info;

    const s3 = get_source_bucket_aws_connection(source_bucket_id, aws_log_replication_info);

    let candidates_map = {};
    let logs_retrieved_count = config.AWS_LOG_CANDIDATES_LIMIT;

    do {
        const next_log_list = await aws_list_next_log(s3, logs_bucket, logs_prefix, continuation_token);
        if (continuation_token === next_log_list.NextContinuationToken) break;

        const next_log = await aws_get_next_log(s3, logs_bucket, next_log_list.Contents[0].Key);
        aws_parse_log_object(candidates_map, next_log);
        logs_retrieved_count -= 1;
    }
    while (Object.keys(candidates_map).length < candidates_limit && logs_retrieved_count);

    return candidates_map;
}

async function aws_list_next_log(s3, logs_bucket, logs_prefix, continuation_token) {
    try {
        dbg.log1('log_parser aws_get_next_log: params:', logs_bucket, logs_prefix, continuation_token);
        const res = await s3.listObjectsV2({
            Bucket: logs_bucket,
            Prefix: logs_prefix,
            ContinuationToken: continuation_token,
            MaxKeys: 1
        }).promise();

        dbg.log1('log_parser aws_get_next_log: finished successfully ', res.Contents.map(c => c.Key));
        return res;

    } catch (err) {
        dbg.error('log_parser aws_get_next_log: error:', err);
        throw err;
    }
}

async function aws_get_next_log(s3, bucket, key) {
    try {
        dbg.log1('log_parser aws_get_next_log: params:', bucket, key);
        const res = await s3.getObject({
            Bucket: bucket,
            Key: key,
            ResponseContentType: 'json'
        }).promise();

        dbg.log1('log_parser aws_get_next_log: finished successfully ', res);
        return res;

    } catch (err) {
        dbg.error('log_parser aws_get_next_log: error:', err);
        throw err;
    }
}

function aws_parse_log_object(candidates_map, log_object) {
    const log_string = log_object.Body.toString();
    const log_array = log_string.split("\n");

    for (const line of log_array) {
        let log = parse_aws_log_entry(line);
        if (log.operation) {
            if (log.operation === 'REST.PUT.OBJECT' || log.operation === 'REST.POST.OBJECT') {
                candidates_map[log.key] = log.key;
            }
            if (log.operation === 'REST.DELETE.OBJECT') {
                delete candidates_map[log.key];
            }
        }
    }
}

function get_source_bucket_aws_connection(source_bucket_id, aws_log_replication_info) {
    const source_bucket = system_store.data.get_by_id(source_bucket_id);
    const { logs_bucket } = aws_log_replication_info;

    const s3_resource_connection_info =
        system_store.data.get_namespace_resource_extended_info(source_bucket.namespace.write_resource.resource).connection_info;

    const agent = s3_resource_connection_info.endpoint_type === 'AWS' ?
        http_utils.get_default_agent(s3_resource_connection_info.endpoint) :
        http_utils.get_unsecured_agent(s3_resource_connection_info.endpoint);

    const s3 = new AWS.S3({
        params: { Bucket: logs_bucket },
        endpoint: s3_resource_connection_info.endpoint,
        accessKeyId: s3_resource_connection_info.access_key,
        secretAccessKey: s3_resource_connection_info.secret_key,
        signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(s3_resource_connection_info.endpoint,
            s3_resource_connection_info.auth_method),
        s3ForcePathStyle: true,
        httpOptions: { agent }
    });

    return s3;
}

function parse_aws_log_entry(log_entry) {
    const match = saw(log_entry).match(AWS_ACCESS_LOG_REGEXP);
    if (!match.toBoolean()) {
        return;
    }

    const log_object = match.toObject(
        'bucket_owner',
        'bucket',
        'time',
        'remote_ip',
        'requester',
        'request_id',
        'operation',
        'key',
        'request_uri',
        'http_status',
        'error_code',
        'bytes_sent',
        'object_size',
        'total_time',
        'turn_around_time',
        'referrer',
        'user_agent',
        'version_id'
    );

    if (log_object.http_status) {
        log_object.http_status = parseInt(log_object.http_status, 10);
    }

    if (log_object.bytes_sent) {
    log_object.bytes_sent = parseInt(log_object.bytes_sent, 10);
    }

    if (log_object.object_size) {
        log_object.object_size = parseInt(log_object.object_size, 10);
    }

    if (log_object.total_time) {
        log_object.total_time = parseInt(log_object.total_time, 10);
    }

    if (log_object.turn_around_time) {
        log_object.turn_around_time = parseInt(log_object.turn_around_time, 10);
    }

    if (log_object.time) {
    log_object.time = moment(log_object.time, 'DD/MMM/YYYY:HH:mm:ss Z').toDate();
    }

    return log_object;
}

// EXPORTS
exports.get_log_candidates = get_log_candidates;
