/* Copyright (C) 2025 NooBaa */
'use strict';
//const config = require('../../../../config');
const dbg = require('../../../util/debug_module')(__filename);
const config = require('../../../../config');
const system_store = require('../../../server/system_services/system_store').get_instance();

const { VectorError } = require('../vector_errors');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_S3VectorBuckets_CreateVectorBucket.html
 */
async function post_vector_bucket(req, res) {

    dbg.log0("post_vector_bucket body =", req.body, ", headers =", req.headers);

    let ns_name = req.headers[config.VECTORS_NSR_HEADER];
    const subpath = req.headers[config.NSFS_CUSTOM_BUCKET_PATH_HTTP_HEADER];
    const vector_db_type = req.headers[config.VECTORS_DB_TYPE_HEADER] || 'lance';

    //if ns was not explicitly given in header, try account's default resource
    if (!ns_name) {
        const default_resource_name = req.object_sdk?.requesting_account.default_resource;
        const default_resource = system_store?.data?.systems[0]?.namespace_resources_by_name[default_resource_name];
        //only nsfs resources are applicable
        if (default_resource && default_resource.nsfs_config) {
            ns_name = default_resource_name;
        }
    }

    // NS header is mandatory for containerized, optional for NC NSFS
    if (!ns_name && !req.object_sdk.nsfs_config_root) {
        throw new VectorError({
            code: VectorError.ValidationException.code,
            http_code: VectorError.ValidationException.http_code,
            message: VectorError.ValidationException.message,
            fieldList: [{path: config.VECTORS_NSR_HEADER, message: "Missing"}],
        });
    }

    const namespace_resource = ns_name ? {
        resource: ns_name,
        path: subpath //not to be confused with nsr path
    } : undefined;

    const vector_bucket_name = req.body.vectorBucketName;
    await req.vector_sdk.create_vector_bucket({
        vector_bucket_name,
        namespace_resource,
        vector_db_type
    });
}

exports.handler = post_vector_bucket;

