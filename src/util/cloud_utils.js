/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('./debug_module')(__filename);
const { RpcError } = require('../rpc');
const http_utils = require('./http_utils');
const AWS = require('aws-sdk');
const url = require('url');
const _ = require('lodash');

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
            accessKeyId: params.access_key.unwrap(),
            secretAccessKey: params.secret_key.unwrap()
        },
        s3ForcePathStyle: true,
        sslEnabled: false,
        signatureVersion: get_s3_endpoint_signature_ver(params.endpoint),
        s3DisableBodySigning: disable_s3_compatible_bodysigning(params.endpoint),
        region: 'eu-central-1',
        httpOptions: {
            agent: agent
        }
    });
    return s3.getSignedUrl(
        'getObject', {
            Bucket: params.bucket.unwrap(),
            Key: params.key,
            VersionId: params.version_id,
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


function is_aws_endpoint(endpoint) {
    const endpoint_url = url.parse(endpoint);
    const is_aws = endpoint_url.host && endpoint_url.host.endsWith('amazonaws.com');
    return is_aws;
}

function disable_s3_compatible_bodysigning(endpoint) {
    const endpoint_url = url.parse(endpoint);
    const disable_sign = Boolean(!is_aws_endpoint(endpoint) && endpoint_url.protocol === 'http:');
    return disable_sign;
}

function get_s3_endpoint_signature_ver(endpoint, auth_method) {
    if (auth_method === 'AWS_V4') return 'v4';
    if (auth_method === 'AWS_V2') return 'v2';
    if (is_aws_endpoint(endpoint)) {
        return 'v4';
    } else {
        return 'v2';
    }
}

function get_used_cloud_targets(endpoint_type, bucket_list, pool_list, namespace_resources) {
    const cloud_resource_targets = pool_list ? pool_list.filter(pool =>
            (pool.cloud_pool_info && !pool.cloud_pool_info.pending_delete && _.includes(endpoint_type, pool.cloud_pool_info.endpoint_type)))
        .map(pool_with_cloud_resource => ({
            endpoint: pool_with_cloud_resource.cloud_pool_info.endpoint,
            endpoint_type: pool_with_cloud_resource.cloud_pool_info.endpoint_type,
            source_name: pool_with_cloud_resource.name,
            target_name: pool_with_cloud_resource.cloud_pool_info.target_bucket,
            usage_type: 'CLOUD_RESOURCE'
        })) : [];
    const namespace_resource_targets = namespace_resources ?
        namespace_resources.filter(ns => _.includes(endpoint_type, ns.connection.endpoint_type))
        .map(ns_rec => (_.omitBy({
            endpoint: ns_rec.connection.endpoint,
            endpoint_type: ns_rec.connection.endpoint_type,
            cp_code: ns_rec.connection.cp_code || undefined,
            source_name: ns_rec.name,
            target_name: ns_rec.connection.target_bucket,
            usage_type: 'NAMESPACE_RESOURCE'
        }, _.isUndefined))) : [];
    return _.concat(cloud_resource_targets, namespace_resource_targets);
}

exports.find_cloud_connection = find_cloud_connection;
exports.get_azure_connection_string = get_azure_connection_string;
exports.get_signed_url = get_signed_url;
exports.get_used_cloud_targets = get_used_cloud_targets;
exports.get_s3_endpoint_signature_ver = get_s3_endpoint_signature_ver;
exports.is_aws_endpoint = is_aws_endpoint;
exports.disable_s3_compatible_bodysigning = disable_s3_compatible_bodysigning;
