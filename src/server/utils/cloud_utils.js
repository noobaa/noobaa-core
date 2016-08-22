'use strict';


var _ = require('lodash');
const dbg = require('../../util/debug_module')(__filename);
const RpcError = require('../../rpc/rpc_error');
const AWS = require('aws-sdk');


/**
 *
 * RESOLVE_CLOUD_SYNC_INFO
 *
 */
function resolve_cloud_sync_info(sync_policy) {
    var stat;
    if (!_.isEmpty(sync_policy)) {
        //If sync time is epoch (never synced) change to never synced
        if (sync_policy.paused) {
            stat = 'PAUSED';
        } else if (!sync_policy.health) {
            stat = 'UNABLE';
        } else if (sync_policy.last_sync.getTime() === 0) {
            stat = 'PENDING';
        } else if (sync_policy.status === 'IDLE') {
            stat = 'SYNCED';
        } else {
            stat = 'SYNCING';
        }
    } else {
        stat = 'NOTSET';
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


exports.resolve_cloud_sync_info = resolve_cloud_sync_info;
exports.find_cloud_connection = find_cloud_connection;
exports.get_signed_url = get_signed_url;
