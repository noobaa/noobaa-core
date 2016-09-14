'use strict';


var _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const AWS = require('aws-sdk');
const url = require('url');


/**
 *
 * RESOLVE_CLOUD_SYNC_INFO
 *
 */
function resolve_cloud_sync_info(sync_policy) {
    var stat;
    if (_.isEmpty(sync_policy)) {
        stat = 'NOTSET';
        //If sync time is epoch (never synced) change to never synced
    } else if (sync_policy.paused) {
        stat = 'PAUSED';
    } else if (!sync_policy.health) {
        stat = 'UNABLE';
    } else if (sync_policy.status === 'SYNCING') {
        stat = 'SYNCING';
    } else if (sync_policy.last_sync.getTime() === 0) {
        stat = 'PENDING';
    } else {
        // if we have a time for the last sync, and the status isn't syncing (then it's idle) it means we're synced.
        stat = 'SYNCED';
    }
    return stat;
}

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
    let connection_string = 'DefaultEndpointsProtocol=' + (endpoint_url.protocol ? endpoint_url.protocol : 'http') + ';';
    connection_string += 'AccountName=' + params.access_key + ';';
    connection_string += 'AccountKey=' + params.secret_key + ';';

    const AZURE_BLOB_ENDPOINT = 'blob.core.windows.net';
    if (endpoint_url.host !== AZURE_BLOB_ENDPOINT) {
        connection_string += 'BlobEndpoint=' + params.endpoint + ';';
    }
    return connection_string;
}


exports.resolve_cloud_sync_info = resolve_cloud_sync_info;
exports.find_cloud_connection = find_cloud_connection;
exports.get_azure_connection_string = get_azure_connection_string;
exports.get_signed_url = get_signed_url;
