/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/multiobjectdeleteapi.html
 * AKA "Multi Object Delete"
 */
async function post_bucket_delete(req) {

    // The request body XML format:
    // Delete (Required), Object (Required), Quiet (Not Required)
    // Parsing the XML and throw an error in case the required part are not included
    const delete_data = req.body.Delete;
    if (!delete_data) throw new S3Error(S3Error.MalformedXML);
    const delete_list = req.body.Delete.Object;
    if (!delete_list) throw new S3Error(S3Error.MalformedXML);
    const quiet = req.body.Delete.Quiet?.[0];

    if (delete_list.length > 1000) {
        dbg.error('The request can not contain a list of more than 1000 keys');
        throw new S3Error(S3Error.MalformedXML);
    }

    // Removing duplicated entries
    // note: it was intentionally that first we check the list length and only then remove duplications
    const uniq_map = new Map();
    for (const item of delete_list) {
        const key = item.Key?.[0];
        const version_id = item.VersionId?.[0];
        const key_version = (key || '') + '\0' + (version_id || ''); // using null char (\x00) as separator
        uniq_map.set(key_version, { key, version_id });
    }
    const objects = Array.from(uniq_map.values());
    dbg.log3('post_bucket_delete: objects without duplications', objects);

    const reply = await req.object_sdk.delete_multiple_objects({
        bucket: req.params.bucket,
        objects
    });

    const results = [];
    results.length = objects.length;
    for (let i = 0; i < results.length; ++i) {
        const req_obj = objects[i];
        const res_obj = reply[i];
        if (res_obj.err_code && !quiet) {
            results[i] = {
                Error: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    Code: res_obj.err_code,
                    Message: res_obj.err_message,
                }
            };
        } else if (res_obj.created_delete_marker) {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    DeleteMarker: true,
                    DeleteMarkerVersionId: res_obj.created_version_id,
                }
            };
        } else if (res_obj.deleted_delete_marker) {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                    DeleteMarker: true,
                    DeleteMarkerVersionId: res_obj.deleted_version_id,
                }
            };
        } else {
            results[i] = {
                Deleted: {
                    Key: req_obj.key,
                    VersionId: req_obj.version_id,
                }
            };
        }
    }

    return { DeleteResult: results };
}

module.exports = {
    handler: post_bucket_delete,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'xml',
    },
};
