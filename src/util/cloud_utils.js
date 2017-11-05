/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const { RpcError } = require('../rpc');
const http_utils = require('./http_utils');
const AWS = require('aws-sdk');
const url = require('url');

function find_cloud_connection(account, conn_name) {
    let conn = (account.sync_credentials_cache || [])
        .filter(sync_conn => sync_conn.name === conn_name)[0];

    if (!conn) {
        dbg.error('CONNECTION NOT FOUND', account, conn_name);
        throw new RpcError('INVALID_CONNECTION', 'Connection dosn\'t exists: "' + conn_name + '"');
    }

    return conn;
}


function get_signed_url(params) {
    let agent = http_utils.get_unsecured_http_agent(params.endpoint);
    let s3 = new AWS.S3({
        endpoint: params.endpoint,
        credentials: {
            accessKeyId: params.access_key,
            secretAccessKey: params.secret_key
        },
        s3ForcePathStyle: true,
        sslEnabled: false,
        signatureVersion: 'v4',
        region: 'eu-central-1',
        httpOptions: {
            agent: agent
        }
    });
    return s3.getSignedUrl(
        'getObject', {
            Bucket: params.bucket,
            Key: params.key,
            Expires: 604800
        }
    );
}

function get_azure_connection_string(params) {
    let endpoint_url = url.parse(params.endpoint);
    let protocol = (endpoint_url.protocol ? endpoint_url.protocol : 'http:');
    protocol = protocol.slice(0, protocol.length - 1);
    let connection_string = 'DefaultEndpointsProtocol=' + protocol + ';';
    connection_string += 'AccountName=' + params.access_key + ';';
    connection_string += 'AccountKey=' + params.secret_key + ';';

    const AZURE_BLOB_ENDPOINT = 'blob.core.windows.net';
    if (endpoint_url.host !== AZURE_BLOB_ENDPOINT) {
        connection_string += 'BlobEndpoint=' + params.endpoint + ';';
    }
    return connection_string;
}


function get_used_cloud_targets(endpoint_type, bucket_list, pool_list, namespace_resources) {
    const cloud_sync_targets = bucket_list ? bucket_list.filter(bucket =>
            (bucket.cloud_sync && bucket.cloud_sync.endpoint_type === endpoint_type))
        .map(bucket_with_cloud_sync => ({
            endpoint: bucket_with_cloud_sync.cloud_sync.endpoint,
            endpoint_type: bucket_with_cloud_sync.cloud_sync.endpoint_type,
            source_name: bucket_with_cloud_sync.name,
            target_name: bucket_with_cloud_sync.cloud_sync.target_bucket,
            usage_type: 'CLOUD_SYNC'
        })) : [];
    const cloud_resource_targets = pool_list ? pool_list.filter(pool =>
            (pool.cloud_pool_info && !pool.cloud_pool_info.pending_delete && pool.cloud_pool_info.endpoint_type === endpoint_type))
        .map(pool_with_cloud_resource => ({
            endpoint: pool_with_cloud_resource.cloud_pool_info.endpoint,
            endpoint_type: pool_with_cloud_resource.cloud_pool_info.endpoint_type,
            source_name: pool_with_cloud_resource.name,
            target_name: pool_with_cloud_resource.cloud_pool_info.target_bucket,
            usage_type: 'CLOUD_RESOURCE'
        })) : [];
    const namespace_resource_targets = namespace_resources ? namespace_resources.filter(ns => ns.connection.endpoint_type === endpoint_type)
        .map(ns_rec => ({
            endpoint: ns_rec.connection.endpoint,
            endpoint_type: ns_rec.connection.endpoint_type,
            source_name: ns_rec.name,
            target_name: ns_rec.connection.target_bucket,
            usage_type: 'NAMESPACE_RESOURCE'
        })) : [];
    return cloud_sync_targets.concat(cloud_resource_targets).concat(namespace_resource_targets);
}

exports.find_cloud_connection = find_cloud_connection;
exports.get_azure_connection_string = get_azure_connection_string;
exports.get_signed_url = get_signed_url;
exports.get_used_cloud_targets = get_used_cloud_targets;
