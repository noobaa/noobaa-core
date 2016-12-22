'use strict';

const dbg = require('./debug_module')(__filename);
const RpcError = require('../rpc/rpc_error');
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
    let s3 = new AWS.S3({
        endpoint: params.endpoint,
        credentials: {
            accessKeyId: params.access_key,
            secretAccessKey: params.secret_key
        },
        s3ForcePathStyle: true,
        sslEnabled: false,
        signatureVersion: 'v4',
        region: 'eu-central-1'
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
    let protocol = (endpoint_url.protocol ? endpoint_url.protocol : 'http');
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


exports.find_cloud_connection = find_cloud_connection;
exports.get_azure_connection_string = get_azure_connection_string;
exports.get_signed_url = get_signed_url;
