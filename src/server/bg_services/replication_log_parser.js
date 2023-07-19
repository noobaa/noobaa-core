/* Copyright (C) 2016 NooBaa */
'use strict';

const AWS = require('aws-sdk');
const system_store = require('../system_services/system_store').get_instance();
const replication_store = require('../system_services/replication_store').instance();
const cloud_utils = require('../../util/cloud_utils');
const http_utils = require('../../util/http_utils');
const pool_server = require('../system_services/pool_server');
const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const moment = require('moment');
const { LogsQueryClient, LogsQueryResultStatus } = require("@azure/monitor-query");
const { ClientSecretCredential } = require("@azure/identity");

/**
 * get_log_candidates will return an object which contains the log candidates
 * @param {*} source_bucket_id ID of the source bucket
 * @param {string} rule_id ID of the replication rule
 * @param {Record<any, any>} replicationconfig Replication configuration
 * @param {Number} candidates_limit Candidates limit
 * @param {boolean} sync_deletions - Whether deletions should be synced or not
 * @returns {Promise<{
 *  items: nb.ReplicationLogCandidates,
 *  done: () => Promise<void>
 * }>} Candidates
 */
async function get_log_candidates(source_bucket_id, rule_id, replicationconfig, candidates_limit, sync_deletions) {
    const source_bucket = system_store.data.get_by_id(source_bucket_id);
    const endpoint_type = source_bucket.namespace.write_resource.resource.connection.endpoint_type;
    if (endpoint_type === "AWS") {
        return get_aws_log_candidates(source_bucket_id, rule_id, replicationconfig, candidates_limit, sync_deletions);
    } else if (endpoint_type === "AZURE") {
        return get_azure_log_candidates(source_bucket_id, rule_id, replicationconfig, candidates_limit, sync_deletions);
    } else {
        throw new Error(`REPLICATION_LOG_PARSER: Unsupported endpoint type ${endpoint_type}`);
    }
}

async function get_aws_log_candidates(source_bucket_id, rule_id, replication_config, candidates_limit, sync_deletions) {
    const aws_log_replication_info = replication_config.log_replication_info.aws_log_replication_info;
    const { logs_bucket, prefix } = aws_log_replication_info.logs_location;
    const s3 = get_source_bucket_aws_connection(source_bucket_id, aws_log_replication_info);
    let continuation_token = get_continuation_token_for_rule(rule_id, replication_config);

    const logs = [];
    let logs_retrieved_count = config.AWS_LOG_CANDIDATES_LIMIT;

    do {
        const next_log_entry = await aws_get_next_log_entry(s3, logs_bucket, prefix, continuation_token);

        // save the continuation token for the next iteration
        continuation_token = next_log_entry.NextContinuationToken;

        // Check if there is any log entry - if there are no more log entries
        // then no need to process anything
        if (!next_log_entry.Contents || next_log_entry.Contents.length === 0) {
            dbg.log0('log_parser: no more log entries');
            break;
        }

        const next_log_data = await aws_get_next_log(s3, logs_bucket, next_log_entry.Contents[0].Key);
        aws_parse_log_object(logs, next_log_data, sync_deletions);

        logs_retrieved_count -= 1;
    }
    while ((logs.length < candidates_limit) && logs_retrieved_count !== 0 && continuation_token);

    return {
        items: create_candidates(logs),
        done: async () => {
            if (continuation_token) {
                await replication_store.update_log_replication_marker_by_id(replication_config._id, rule_id, { continuation_token });
            }
        },
    };
}

async function get_azure_log_candidates(source_bucket_id, rule_id, replication_config, candidates_limit, sync_deletions) {
    const source_bucket = system_store.data.get_by_id(source_bucket_id);
    const namespace_resource = source_bucket.namespace.write_resource.resource;
    const src_storage_account = namespace_resource.connection.access_key;
    const src_container_name = namespace_resource.connection.target_bucket;
    const prefix = replication_config.log_replication_info.azure_log_replication_info.prefix || '';
    const { logs_query_client, monitor_workspace_id } = get_source_bucket_azure_connection(source_bucket_id);
    let candidates;

    //Our "continuation token" is the timestamp of the the last log retrieval
    let continuation_token = get_continuation_token_for_rule(rule_id, replication_config);
    let duration;
    if (continuation_token) {
        duration = `${parseInt(continuation_token, 10)}ms`;
    } else {
        duration = '1h';
    }

    const kusto_query =
    `set truncationmaxsize=${config.AZURE_QUERY_TRUNCATION_MAX_SIZE_IN_BITS};
    StorageBlobLogs
    | where TimeGenerated > ago(${duration})
    | project Time=TimeGenerated, Action=substring(Category, 7), Key=ObjectKey
    | sort by Time asc
    | where Action == "Write" or Action == "Delete"
    | where Key startswith "/${src_storage_account.unwrap()}/${src_container_name}/${prefix}"
    | where Key !contains "test-delete-non-existing-"
    | parse Key with * "/" StorageAccount "/" Container "/" Key
    | project Time, Action, Key`;

    const query_result = await logs_query_client.queryWorkspace(
        monitor_workspace_id.unwrap(),
        kusto_query,
        { duration: duration },
        {serverTimeoutInSeconds: 300}
    );

    if (query_result.status === LogsQueryResultStatus.Success) {
        const tables_from_result = query_result.tables;
        if (tables_from_result && tables_from_result[0].rows.length > 0) {
            const result_rows = query_result.tables[0].rows;
            // @ts-ignore - Needed since the format of `rows` is changed in the Kusto query - project Time, Action, Key
            // So there's a mismatch between what the code expects and what it actually receives
            // The continuation token is the timestamp of the latest entry that was processed
            continuation_token = (Date.now() - result_rows[result_rows.length - 1][0]).toString();
            dbg.log1("get_azure_log_candidates: Found new Azure logs:");
            dbg.log1(tables_from_result[0]);
            dbg.log1("get_azure_log_candidates: Parsing Azure logs");
            const logs = [];
            azure_parse_log_object(logs, query_result, sync_deletions);
            dbg.log1("get_azure_log_candidates: logs", logs);
            candidates = create_candidates(logs);
            dbg.log1("get_azure_log_candidates: candsidates", candidates);
        } else {
            dbg.log1("get_azure_log_candidates: No new Azure logs found to process");
        }
        if (tables_from_result.length === 0) {
            dbg.log1(`get_azure_log_candidates: No results for Azure replication query '${kusto_query}'`);
            return;
        }
    } else {
        dbg.error(`get_azure_log_candidates: Error processing the Azure replication query '${kusto_query}' - ${query_result.partialError}`);
        if (query_result.partialTables.length > 0) {
            console.warn(`get_azure_log_candidates: The Azure replication query has also returned partial data in the following table(s) - ${query_result.partialTables}`);
            }
    }

    return {
        items: candidates,
        done: async () => {
            await replication_store.update_log_replication_marker_by_id(replication_config._id, rule_id, { continuation_token });
        },
    };
}

/**
 * create_candidates will iterate over all the logs and will return an array of candidates
 * such that there will be ONLY one action per key (object). It will do so by sorting the sorting
 * by time and in case of conflicts, it will replace the action with 'conflict'. 
 * 
 * The function that consumes the candidates should handle the conflict action.
 * @param {nb.ReplicationLogs} logs 
 * @returns {nb.ReplicationLogCandidates}
 */
function create_candidates(logs) {
    /**
     * @type {Record<string, Map<Date, nb.ReplicationLog>>}
     */
    const logs_per_key = {};

    for (const log of logs) {
        const { key } = log;
        if (!logs_per_key[key]) {
            logs_per_key[key] = new Map();
        }

        const logs_for_key_time_map = logs_per_key[key];

        // if there is already a candidate for the same key, then we have a conflict
        if (logs_for_key_time_map.has(log.time)) {
            // TODO: Object versioning will raise false alarms here
            const conflict_log = logs_for_key_time_map.get(log.time);
            conflict_log.action = 'conflict';
        } else {
            logs_for_key_time_map.set(log.time, log);
        }
    }

    /**
     * @type {nb.ReplicationLogCandidates}
     */
    const candidates = {};

    Object.keys(logs_per_key).forEach(key => {
        const logs_for_key_time_map = logs_per_key[key];
        const logs_for_key = Array.from(logs_for_key_time_map.values());
        const sorted_logs_for_key = logs_for_key.sort((a, b) => a.time.getTime() - b.time.getTime());

        candidates[key] = sorted_logs_for_key;
    });

    return candidates;
}

async function aws_get_next_log_entry(s3, logs_bucket, logs_prefix, continuation_token) {
    let start_after = logs_prefix;
    if (start_after && !start_after.endsWith('/')) {
        start_after += '/';
    }

    try {
        dbg.log1('log_parser aws_get_next_log_entry: params:', logs_bucket, logs_prefix, continuation_token);
        const res = await s3.listObjectsV2({
            Bucket: logs_bucket,
            Prefix: logs_prefix,
            ContinuationToken: continuation_token,
            MaxKeys: 1,
            StartAfter: start_after,
        }).promise();

        dbg.log1('log_parser aws_get_next_log_entry: finished successfully ', res);
        return res;

    } catch (err) {
        dbg.error('log_parser aws_get_next_log_entry: error:', err);
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

/**
 * aws_parse_log_object will parse the log object and will return an array of candidates
 * @param {nb.ReplicationLogs} logs - Log array
 * @param {*} log_object  - AWS log object
 * @param {boolean} sync_deletions  - Whether deletions should be synced or not
 */
function aws_parse_log_object(logs, log_object, sync_deletions) {
    const log_string = log_object.Body.toString();
    const log_array = log_string.split("\n");

    for (const line of log_array) {
        if (line !== '') {
            const log = parse_aws_log_entry(line);
            if (log.operation) {

                if (log.operation.includes('PUT.OBJECT') || log.operation.includes('POST.OBJECT')) {
                    logs.push({
                        key: log.key,
                        action: 'copy',
                        time: log.time,
                    });
                }
                if (log.operation.includes('DELETE.OBJECT') && sync_deletions && log.http_status === 204) {
                    logs.push({
                        key: log.key,
                        action: 'delete',
                        time: log.time,
                    });
                }
            }
        }
    }
}

/**
 * azure_parse_log_object will parse the log object and will return an array of candidates
 * @param {nb.ReplicationLogs} logs - Log array
 * @param {*} query_result  - A Kusto query result
 */
function azure_parse_log_object(logs, query_result, sync_deletions) {
    // The query's result format is a matrix.
    // The index values of each row are as following:
    // 0: Time of operation
    // 1: Operation (can only ever be Write or Delete)
    // 2: Object key
    for (const row_array of query_result.tables[0].rows) {
        const [ time, operation, key ] = row_array;
        if (operation === "Write") {
            logs.push({
                key: key,
                action: 'copy',
                time: time,
            });
        // Anything that isn't Write, has to be Delete
        // Any other action is filtered in the query level
        // Regardless, keeping the if for readability
        } else if (operation === "Delete" && sync_deletions) {
            logs.push({
                key: key,
                action: 'delete',
                time: time,
            });
        }
    }
}

function get_source_bucket_azure_connection(source_bucket_id) {
    const source_bucket = system_store.data.get_by_id(source_bucket_id);
    const extended_ns_info = pool_server.get_namespace_resource_extended_info(source_bucket.namespace.write_resource.resource);
    const azure_log_access_keys = extended_ns_info.azure_log_access_keys;
    const { azure_tenant_id, azure_client_id, azure_client_secret, azure_logs_analytics_workspace_id } = azure_log_access_keys;
    const azure_token_credential = new ClientSecretCredential(
        azure_tenant_id.unwrap(),
        azure_client_id.unwrap(),
        azure_client_secret.unwrap()
    );
    return { logs_query_client: new LogsQueryClient(azure_token_credential), monitor_workspace_id: azure_logs_analytics_workspace_id };
}

function get_source_bucket_aws_connection(source_bucket_id, aws_log_replication_info) {
    const source_bucket = system_store.data.get_by_id(source_bucket_id);
    const logs_location = aws_log_replication_info.logs_location;
    const { logs_bucket } = logs_location;

    const s3_resource_connection_info =
        pool_server.get_namespace_resource_extended_info(source_bucket.namespace.write_resource.resource);

    const agent = s3_resource_connection_info.endpoint_type === 'AWS' ?
        http_utils.get_default_agent(s3_resource_connection_info.endpoint) :
        http_utils.get_unsecured_agent(s3_resource_connection_info.endpoint);

    const s3 = new AWS.S3({
        params: { Bucket: logs_bucket },
        endpoint: s3_resource_connection_info.endpoint,
        accessKeyId: s3_resource_connection_info.access_key.unwrap(),
        secretAccessKey: s3_resource_connection_info.secret_key.unwrap(),
        signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(s3_resource_connection_info.endpoint,
            s3_resource_connection_info.auth_method),
        s3ForcePathStyle: true,
        httpOptions: { agent }
    });

    return s3;
}

/**
 * 
 * @param {string} log_entry 
 * @returns {{
 *  bucket_owner: string | null,
 *  bucket: string | null,
 *  time: Date | null,
 *  remote_ip: string | null,
 *  requester: string | null,
 *  request_id: string | null,
 *  operation: string | null,
 *  key: string | null,
 *  request_uri: string | null,
 *  http_status: number | null,
 *  error_code: string | null,
 *  bytes_sent: number | null,
 *  object_size: number | null,
 *  total_time: number | null,
 *  turn_around_time: number | null,
 *  referrer: string | null,
 *  user_agent: string | null,
 *  version_id: string | null,
 *  host_id: string | null,
 *  signature_version: string | null,
 *  cipher_suite: string | null,
 *  authentication_type: string | null,
 *  host_header: string | null,
 *  tls_version: string | null,
 *  access_point_arn: string | null,
 *  acl_required: Boolean | null,
 * } | Record<string, any>}
 */
function parse_aws_log_entry(log_entry) {
    console.log('entry:', log_entry);

    if (typeof log_entry === "undefined") return;

    try {
        const log_object_structure = {
            'bucket_owner': null,
            'bucket': null,
            'time': parse_aws_log_date,
            'remote_ip': null,
            'requester': null,
            'request_id': null,
            'operation': null,
            'key': null,
            'request_uri': null,
            'http_status': parseInt,
            'error_code': null,
            'bytes_sent': parseInt,
            'object_size': parseInt,
            'total_time': parseInt,
            'turn_around_time': parseInt,
            'referrer': null,
            'user_agent': null,
            'version_id': null,
            'host_id': null,
            'signature_version': null,
            'cipher_suite': null,
            'authentication_type': null,
            'host_header': null,
            'tls_version': null,
            'access_point_arn': null,
            'acl_required': Boolean
        };

        const ParseStates = {
            START: 0,
            IN_VALUE: 1,
            IN_VALUE_BRACKETS: 2,
            IN_VALUE_QUOTED: 3,
        };

        let state = ParseStates.START;
        let value = "";
        const values = [];
        for (const c of log_entry) {
            if (state === ParseStates.START) {
                if (c === " ") {
                    value = "";
                } else if (c === "[") {
                    state = ParseStates.IN_VALUE_BRACKETS;
                } else if (c === '"') {
                    state = ParseStates.IN_VALUE_QUOTED;
                } else {
                    value += c;
                    state = ParseStates.IN_VALUE;
                }
            } else if (state === ParseStates.IN_VALUE) {
                if (c === " ") {
                    values.push(value);
                    value = "";
                    state = ParseStates.START;
                } else {
                    value += c;
                }
            } else if (state === ParseStates.IN_VALUE_BRACKETS) {
                if (c === "]") {
                    values.push(`[${value}]`);
                    value = "";
                    state = ParseStates.START;
                } else {
                    value += c;
                }
            } else if (state === ParseStates.IN_VALUE_QUOTED) {
                if (c === '"') {
                    values.push(value);
                    value = "";
                    state = ParseStates.START;
                } else {
                    value += c;
                }
            }
        }

        const result = {};
        Object.keys(log_object_structure).forEach(field => {
            const val = values.shift();
            if (val === undefined) {
                result[field] = null;
            } else {
                result[field] = parse_potentially_empty_log_value(val, log_object_structure[field]);
            }
        });

        return result;
    } catch (err) {
        dbg.error('parse_aws_log_entry: failed to parse log entry - unexpected structure', err);
        return {};
    }
}

function parse_aws_log_date(log_date) {
    return moment(log_date, 'DD/MMM/YYYY:HH:mm:ss Z').toDate();
}

function parse_potentially_empty_log_value(log_value, custom_parser) {
    if (log_value === '-') {
        return null;
    }

    if (typeof custom_parser === 'function') {
        return custom_parser(log_value);
    }

    return log_value;
}

function get_continuation_token_for_rule(rule_id, replication_config) {
    const replication_rule = replication_config.rules.find(rule => rule.rule_id === rule_id);
    return replication_rule?.rule_log_status?.log_marker?.continuation_token;
}

// EXPORTS
exports.get_log_candidates = get_log_candidates;
exports.aws_parse_log_object = aws_parse_log_object;
exports.azure_parse_log_object = azure_parse_log_object;
exports.create_candidates = create_candidates;
