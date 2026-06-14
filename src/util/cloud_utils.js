/* Copyright (C) 2016 NooBaa */
'use strict';
const dbg = require('./debug_module')(__filename);
const fs = require('fs');
const RpcError = require('../rpc/rpc_error');
const http_utils = require('./http_utils');
const string_utils = require('./string_utils');
const AWS = require('aws-sdk');
const url = require('url');
const _ = require('lodash');
const SensitiveString = require('./sensitive_string');
const { STSClient, AssumeRoleWithWebIdentityCommand } = require('@aws-sdk/client-sts');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const config = require('../../config');
const noobaa_s3_client = require('../sdk/noobaa_s3_client/noobaa_s3_client');
const azure_storage = require('./azure_storage_wrap');
// TODO: why do we want to use the wrap and not directly @google-cloud/storage ?
const GoogleStorage = require('./google_storage_wrap');
const { WorkloadIdentityCredential } = require("@azure/identity");

const projectedServiceAccountToken = "/var/run/secrets/openshift/serviceaccount/token";
const defaultRoleSessionName = 'default_noobaa_s3_ops';
const defaultSTSCredsValidity = 3600;

function find_cloud_connection(account, conn_name) {
    const conn = (account.sync_credentials_cache || [])
        .filter(sync_conn => sync_conn.name === conn_name)[0];

    if (!conn) {
        dbg.error('CONNECTION NOT FOUND', account, conn_name);
        throw new RpcError('INVALID_CONNECTION', 'Connection dosn\'t exists: "' + conn_name + '"');
    }

    return conn;
}

async function createSTSS3SDKv3Client(params, additionalParams) {
    const creds = await generate_aws_sdkv3_sts_creds(params, additionalParams.RoleSessionName);
    return noobaa_s3_client.get_s3_client_v3_params({
        credentials: creds,
        region: params.region || config.DEFAULT_REGION,
        endpoint: additionalParams.endpoint,
        requestHandler: new NodeHttpHandler({
            httpsAgent: additionalParams.httpOptions
        }),
        forcePathStyle: additionalParams.s3ForcePathStyle
    });
}

async function generate_aws_sdkv3_sts_creds(params, roleSessionName) {

    const sts_client = new STSClient({ region: params.region || config.DEFAULT_REGION });
    const input = {
        DurationSeconds: defaultSTSCredsValidity,
        RoleArn: params.aws_sts_arn,
        RoleSessionName: roleSessionName || defaultRoleSessionName,
        WebIdentityToken: (await fs.promises.readFile(projectedServiceAccountToken)).toString(),
    };
    const command = new AssumeRoleWithWebIdentityCommand(input);
    const response = await sts_client.send(command);
    if (_.isEmpty(response) || _.isEmpty(response.Credentials)) {
        dbg.error(`AWS STS empty creds ${params.RoleArn}, RolesessionName: ${params.RoleSessionName},Projected service Account Token Path : ${projectedServiceAccountToken}`);
        throw new RpcError('AWS_STS_ERROR', 'Empty AWS STS creds retrieved for Role "' + params.RoleArn + '"');
    }
    return {
        accessKeyId: response.Credentials.AccessKeyId,
        secretAccessKey: response.Credentials.SecretAccessKey,
        sessionToken: response.Credentials.SessionToken,
    };
}

function get_signed_url(params, expiry = 604800, custom_operation = 'getObject') {
    const op = custom_operation;
    const s3 = new AWS.S3({
        endpoint: params.endpoint,
        credentials: {
            accessKeyId: params.access_key.unwrap(),
            secretAccessKey: params.secret_key.unwrap()
        },
        s3ForcePathStyle: true,
        sslEnabled: false,
        signatureVersion: get_s3_endpoint_signature_ver(params.endpoint),
        // IMPORATANT - we had issues with applyChecksum - when migrating to sdkv3 check if this option is needed.
        s3DisableBodySigning: disable_s3_compatible_bodysigning(params.endpoint),
        region: params.region || config.DEFAULT_REGION,
        httpOptions: {
            // Setting the agent is not mandatory in this case as this s3 client
            // is only used to acquire a signed Url
            agent: http_utils.get_unsecured_agent(params.endpoint)
        }
    });
    const response_queries = params.response_queries || {};
    return s3.getSignedUrl(
        op, {
            Bucket: params.bucket.unwrap(),
            Key: params.key,
            VersionId: params.version_id,
            Expires: expiry,
            ...response_queries
        }
    );
}
// TODO: remove it after removed all old library code
// and rename get_azure_new_connection_string to get_azure_connection_string
function get_azure_connection_string(params) {
    const endpoint_url = url.parse(params.endpoint);
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
    const endpoint = system_address[0] && 'http://' + system_address[0].hostname;
    const access_key = sys.owner && sys.owner.access_keys && sys.owner.access_keys[0].access_key.unwrap();
    const secret_key = sys.owner && sys.owner.access_keys && sys.owner.access_keys[0].secret_key.unwrap();
    if (!endpoint || !access_key || !secret_key) {
        dbg.error('set_noobaa_s3_connection: temporary error: invalid noobaa s3 connection details');
        return;
    }
    const s3_client = noobaa_s3_client.get_s3_client_v3_params({
        endpoint: endpoint,
        credentials: {
            accessKeyId: access_key,
            secretAccessKey: secret_key
        },
        forcePathStyle: true,
        tls: false,
        region: config.DEFAULT_REGION,
        requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(endpoint),
    });
    return s3_client;
}

function generate_access_keys() {
    return {
        access_key: new SensitiveString(string_utils.crypto_random_string(20, string_utils.ALPHA_NUMERIC_CHARSET)),
        secret_key: new SensitiveString(string_utils.crypto_random_string(40, string_utils.ALPHA_NUMERIC_CHARSET + '+/')),
    };
}

/**
 * Create Blob service client using connection string
 * Connection string consists of storage account name and key and endpoint sufix
 * eg: DefaultEndpointsProtocol=https;AccountName=noobaaacc;AccountKey=4I**IqPw==;EndpointSuffix=core.windows.net;
 * @param {String} conn_str 
 * @param {Object} params 
 */
function _create_azure_connection(conn_str, params) {

    /** @type {azure_storage.BlobServiceClient} */
    let blob;
    try {
        blob = azure_storage.BlobServiceClient.fromConnectionString(conn_str);
    } catch (err) {
        dbg.error(`got error on BlobServiceClient.fromConnectionString with params`, _.omit(params, 'secret', 'connection_string'), ` error: ${err}`);
        throw err;
    }
    return blob;
}

/**
 * Create Blob service client using managed identity client id, tenant id and federated token in path /var/run/secrets/openshift/serviceaccount/token
 * @param {Object} params 
 */
function _create_azure_sts_connection(params) {

    /** @type {azure_storage.BlobServiceClient} */
    let blob;
    try {
        const url_object = url.parse(params.endpoint, true);
        const host = url_object.host || '';
        const account_host = host.startsWith(params.storage_account) ? host : `${params.storage_account}.${host}`;
        const account_url = `${url_object.protocol}//${account_host}`;
        const credential = new WorkloadIdentityCredential({
            tenantId: params.azure_tenant_id,
            clientId: params.azure_client_id,
            tokenFilePath: projectedServiceAccountToken,
        });
        blob = new azure_storage.BlobServiceClient(account_url, credential);
    } catch (err) {
        dbg.error(`got error on BlobServiceClient() with params`, _.omit(params, 'azure_tenant_id'), ` error: ${err}`);
        throw err;
    }
    return blob;
}

/**
 * Create Azure Blob Service Client based on connection parameters
 * Supports both connection string and STS (managed identity) authentication
 * @param {Object} azure_params Azure connection parameters
 * @param {string} [azure_params.connection_string]  Azure connection string
 * @param {string} [azure_params.endpoint]
 * @param {string} [azure_params.access_key] Storage account name (for STS)
 * @param {string} [azure_params.azure_client_id]
 * @param {string} [azure_params.azure_tenant_id]
 * @returns {azure_storage.BlobServiceClient} Azure Blob Service Client
 */
function create_azure_blob_client(azure_params) {
    /** @type {azure_storage.BlobServiceClient} */
    let blob;
    const is_azure_sts = Boolean(azure_params.azure_client_id);
    try {
        if (is_azure_sts) {
            const sts_cred = {
                endpoint: azure_params.endpoint,
                storage_account: azure_params.access_key,
                azure_client_id: azure_params.azure_client_id,
                azure_tenant_id: azure_params.azure_tenant_id,
            };
            blob = _create_azure_sts_connection(sts_cred);
        } else {
            blob = _create_azure_connection(azure_params.connection_string, azure_params);
        }
    } catch (err) {
        dbg.error(`got error on BlobServiceClient with params`, _.omit(azure_params, 'secret', 'azure_sts_credentials'), ` error: ${err}`);
        throw err;
    }
    return blob;
}


/**
 * Normalize a Google credential secret to a parsed key-file object.
 * @param {string|object} secret_json JSON string or already-parsed key file (returned as-is)
 * @returns {object} secret_json parsed key file object
 */
function parse_google_secret_json(secret_json) {
    return typeof secret_json === 'string' ? JSON.parse(secret_json) : secret_json;
}

/**
 * Build cloud_info.google from endpoint_type and secret_key JSON.
 * GOOGLE_STS keeps the full credentials_json; GOOGLE extracts service-account fields.
 * @param {string} endpoint_type
 * @param {string|object} secret_key JSON string or parsed key file object
 * @returns {{ credentials_json: object } | { project_id: string, client_email: string, private_key: string }}
 */
function build_google_cloud_info(endpoint_type, secret_key) {
    const credentials_json = parse_google_secret_json(secret_key);
    if (endpoint_type === 'GOOGLE_STS') {
        return { credentials_json };
    }
    if (endpoint_type === 'GOOGLE') {
        const { project_id, client_email, private_key } = credentials_json;
        return { project_id, client_email, private_key };
    }
    throw new Error(`Invalid Google endpoint type: ${endpoint_type}`);
}

/**
 * Check if the Google secret is a WIF (STS)
 * There are two types:
 *   1. Long lived token with type 'service_account'
 *   2. Short-lived token (WIF, STS) with type 'external_account'
 * @param {object} credentials_json
 * @returns {boolean}
 */
function is_google_wif_credentials(credentials_json) {
    return Boolean(credentials_json && credentials_json.type === 'external_account');
}

/**
 * Create a Google (GCP) client
 * Supports:
 *   1. Long lived token using Google Service Account.
 *   2. Short-lived token (WIF, STS) using Workload Identity Federation and impersonation of Google service account.
 * Infers auth mode from credentials_json.type (service_account vs external_account).
 * Validates required fields before constructing GoogleStorage to avoid ADC (application default credentials) fallback on incomplete JSON secrets
 * and help debugging issues with invalid credentials.
 * @param {string|object} secret_json JSON string or parsed key file object
 * @returns {import('./google_storage_wrap')}
 */
function create_google_storage_from_connection(secret_json) {
    const credentials_json = parse_google_secret_json(secret_json);
    _validate_google_credentials(credentials_json);
    if (is_google_wif_credentials(credentials_json)) {
        return new GoogleStorage({ credentials: credentials_json });
    }
    return new GoogleStorage({
        credentials: _.pick(credentials_json, 'client_email', 'private_key'),
        projectId: credentials_json.project_id,
    });
}

/**
 * Validate parsed Google credentials before GoogleStorage is constructed.
 *
 * 1) GCP WIF (STS). external_account: checks two groups of fields:
 *   1. STS exchange: audience, subject_token_type, token_url, and credential_source.file (NooBaa
 *      GOOGLE_STS uses a projected token file, e.g. OpenShift service account). An empty credential_source
 *      object passes a truthy check but the auth library rejects it with "A credential source or subject
 *      token supplier must be specified."
 *      Other missing STS fields surface as STS invalid_request errors (e.g. subject_token_type must be nonempty).
 *   2. service_account_impersonation_url: optional in AIP-4117 but required for NooBaa GOOGLE_STS.
 *      Without it, federation may obtain a token that cannot access the target bucket; GCP then
 *      returns 403 "The caller does not have permission" on the first API call.
 * 2) GCP (no STS):
 *    With type: service_account: requires client_email and private_key with type service_account.
 *    Without type: Flat block-store params: client_email and private_key without type (GOOGLE backing store delegation).
 * @param {object} credentials_json Parsed GCP key file object
 */
function _validate_google_credentials(credentials_json) {
    // Arrays are typeof 'object'; reject them so [] does not pass as credentials.
    if (!credentials_json || typeof credentials_json !== 'object' || Array.isArray(credentials_json)) {
        throw new Error('Invalid Google credentials JSON: expected object');
    }
    if (credentials_json.type === 'external_account') {
        if (!credentials_json.audience || !credentials_json.subject_token_type ||
            !credentials_json.token_url) {
            throw new Error('Invalid Google external_account credentials JSON: missing required GCP WIF (STS) fields (audience, subject_token_type, token_url)');
        }
        if (!_is_valid_google_wif_credential_source(credentials_json.credential_source)) {
            throw new Error('Invalid Google external_account credentials JSON: missing or invalid credential_source (expected file path for projected token)');
        }
        if (!credentials_json.service_account_impersonation_url) {
            throw new Error('Invalid Google external_account credentials JSON: missing service_account_impersonation_url');
        }
    } else if (credentials_json.type === 'service_account') {
        if (!credentials_json.client_email || !credentials_json.private_key) {
            throw new Error('Invalid Google service_account credentials JSON: missing required fields (client_email, private_key)');
        }
    } else if (!credentials_json.type && credentials_json.client_email && credentials_json.private_key) {
        // flat block-store params (GOOGLE backing store delegation path)
    } else if (credentials_json.type) {
        throw new Error(`Invalid Google credentials JSON: unsupported type ${credentials_json.type}`);
    } else {
        throw new Error('Invalid Google credentials JSON: expected type field or client_email/private_key');
    }
}

/**
 * Validate credential_source.file is a file path for projected token.
 * credential_source can have other required fields, but we only validate file path for projected token.
 * the full list of properties except file can be found in AIP-4117 External Account Credentials (Workload Identity Federation)
 * @param {object} credential_source credential_source from external_account JSON
 * @returns {boolean}
 */
function _is_valid_google_wif_credential_source(credential_source) {
    if (!credential_source || typeof credential_source !== 'object' || Array.isArray(credential_source)) {
        return false;
    }
    return typeof credential_source.file === 'string' && credential_source.file.length > 0;
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
exports.generate_access_keys = generate_access_keys;
exports.createSTSS3SDKv3Client = createSTSS3SDKv3Client;
exports.generate_aws_sdkv3_sts_creds = generate_aws_sdkv3_sts_creds;
exports.create_azure_blob_client = create_azure_blob_client;
exports.parse_google_secret_json = parse_google_secret_json;
exports.build_google_cloud_info = build_google_cloud_info;
exports.is_google_wif_credentials = is_google_wif_credentials;
exports.create_google_storage_from_connection = create_google_storage_from_connection;
