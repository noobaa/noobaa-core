/* Copyright (C) 2016 NooBaa */
'use strict';
const dbg = require('./debug_module')(__filename);
const fs = require('fs');
const { RpcError } = require('../rpc');
const http_utils = require('./http_utils');
const string_utils = require('./string_utils');
const AWS = require('aws-sdk');
const url = require('url');
const _ = require('lodash');
const SensitiveString = require('./sensitive_string');

const projectedServiceAccountToken = "/var/run/secrets/openshift/serviceaccount/oidc-token";
const defaultRoleSessionName = 'default_noobaa_s3_ops';
const defaultSTSCredsValidity = 3600;

function find_cloud_connection(account, conn_name) {
    let conn = (account.sync_credentials_cache || [])
        .filter(sync_conn => sync_conn.name === conn_name)[0];

    if (!conn) {
        dbg.error('CONNECTION NOT FOUND', account, conn_name);
        throw new RpcError('INVALID_CONNECTION', 'Connection dosn\'t exists: "' + conn_name + '"');
    }

    return conn;
}

async function createSTSS3Client(params, additionalParams) {
    const creds = await generate_aws_sts_creds(params, additionalParams.RoleSessionName);
    return new AWS.S3({
        credentials: creds,
        region: params.region,
        endpoint: additionalParams.endpoint,
        signatureVersion: additionalParams.signatureVersion,
        s3DisableBodySigning: additionalParams.s3DisableBodySigning,
        httpOptions: additionalParams.httpOptions,
        s3ForcePathStyle: additionalParams.s3ForcePathStyle
    });
}

async function generate_aws_sts_creds(params, roleSessionName) {
    const sts = new AWS.STS();
    const creds = await (sts.assumeRoleWithWebIdentity({
        RoleArn: params.aws_sts_arn,
        RoleSessionName: roleSessionName || defaultRoleSessionName,
        WebIdentityToken: (await fs.promises.readFile(projectedServiceAccountToken)).toString(),
        DurationSeconds: defaultSTSCredsValidity
    }).promise());
    if (_.isEmpty(creds.Credentials)) {
        dbg.error(`AWS STS empty creds ${params.RoleArn}, RolesessionName: ${params.RoleSessionName},Projected service Account Token Path : ${projectedServiceAccountToken}`);
        throw new RpcError('AWS_STS_ERROR', 'Empty AWS STS creds retrieved for Role "' + params.RoleArn + '"');
    }
    return new AWS.Credentials(
        creds.Credentials.AccessKeyId,
        creds.Credentials.SecretAccessKey,
        creds.Credentials.SessionToken
    );
}

function get_signed_url(params) {
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
            // Setting the agent is not mandatory in this case as this s3 client
            // is only used to acquire a signed Url
            agent: http_utils.get_unsecured_agent(params.endpoint)
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
// TODO: remove it after removed all old library code
// and rename get_azure_new_connection_string to get_azure_connection_string
function get_azure_connection_string(params) {
    let endpoint_url = url.parse(params.endpoint);
    let protocol = (endpoint_url.protocol ? endpoint_url.protocol : 'http:');
    protocol = protocol.slice(0, protocol.length - 1);
    let connection_string = 'DefaultEndpointsProtocol=' + protocol + ';';
    connection_string += 'AccountName=' + params.access_key.unwrap() + ';';
    connection_string += 'AccountKey=' + params.secret_key.unwrap() + ';';

    const AZURE_BLOB_ENDPOINT = 'blob.core.windows.net';
    if (endpoint_url.host !== AZURE_BLOB_ENDPOINT) {
        connection_string += 'BlobEndpoint=' + params.endpoint + ';';
    }
    return connection_string;
}


function get_azure_new_connection_string(params) {
    const endpoint_url = url.parse(params.endpoint);
    let protocol = (endpoint_url.protocol ? endpoint_url.protocol : 'http:');
    protocol = protocol.slice(0, protocol.length - 1);
    let connection_string = 'DefaultEndpointsProtocol=' + protocol + ';';
    connection_string += 'AccountName=' + params.access_key.unwrap() + ';';
    connection_string += 'AccountKey=' + params.secret_key.unwrap() + ';';

    const AZURE_BLOB_ENDPOINT = 'core.windows.net';
    if (endpoint_url.host === 'blob.' + AZURE_BLOB_ENDPOINT) {
        connection_string += 'EndpointSuffix=' + AZURE_BLOB_ENDPOINT + ';';
    } else {
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
        namespace_resources.filter(ns => ns.connection && _.includes(endpoint_type, ns.connection.endpoint_type))
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

function set_noobaa_s3_connection(sys) {
    const system_address = _.filter(sys.system_address, { 'api': 's3', 'kind': 'INTERNAL' });
    const endpoint = system_address[0] && system_address[0].hostname;
    const access_key = sys.owner && sys.owner.access_keys && sys.owner.access_keys[0].access_key.unwrap();
    const secret_key = sys.owner && sys.owner.access_keys && sys.owner.access_keys[0].secret_key.unwrap();
    dbg.log0('replication_server.set_noobaa_s3_connection: ', endpoint, access_key, secret_key);
    if (!endpoint || !access_key || !secret_key) {
        dbg.error('set_noobaa_s3_connection: temporary error: invalid noobaa s3 connection details');
        return;
    }

    return new AWS.S3({
        endpoint: endpoint,
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key
        },
        s3ForcePathStyle: true,
        sslEnabled: false
    });
}

function generate_access_keys() {
    return {
        access_key: new SensitiveString(string_utils.crypto_random_string(20, string_utils.ALPHA_NUMERIC_CHARSET)),
        secret_key: new SensitiveString(string_utils.crypto_random_string(40, string_utils.ALPHA_NUMERIC_CHARSET + '+/')),
    };
}

exports.find_cloud_connection = find_cloud_connection;
exports.get_azure_connection_string = get_azure_connection_string;
exports.get_azure_new_connection_string = get_azure_new_connection_string;
exports.get_signed_url = get_signed_url;
exports.get_used_cloud_targets = get_used_cloud_targets;
exports.get_s3_endpoint_signature_ver = get_s3_endpoint_signature_ver;
exports.is_aws_endpoint = is_aws_endpoint;
exports.disable_s3_compatible_bodysigning = disable_s3_compatible_bodysigning;
exports.set_noobaa_s3_connection = set_noobaa_s3_connection;
exports.createSTSS3Client = createSTSS3Client;
exports.generate_aws_sts_creds = generate_aws_sts_creds;
exports.generate_access_keys = generate_access_keys;
