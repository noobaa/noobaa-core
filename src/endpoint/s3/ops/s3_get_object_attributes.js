/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');
const S3Error = require('../s3_errors').S3Error;

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGETacl.html
 */
async function get_object_attributes(req, res) {
    const version_id = s3_utils.parse_version_id(req.query.versionId);
    const encryption = _parse_encryption_headers(req);
    const attributes = _parse_attributes(req);

    const params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: version_id,
        encryption: encryption, // GAP - we don't use it currently
        md_conditions: http_utils.get_md_conditions(req), // GAP - we don't use it currently in all namespaces (for example - not in NSFS)
        attributes: attributes,
    };
    dbg.log2('params after parsing', params);
    const reply = await req.object_sdk.get_object_attributes(params);
    s3_utils.set_response_object_md(res, reply);
    s3_utils.set_encryption_response_headers(req, res, reply.encryption);

    return _parse_reply_according_to_attributes(reply, attributes);
}

/**
 * _parse_encryption_headers checks if the client added server side encryption headers and throws an error
 * in case the these are server side encryption customer headers those are parsed and returned
 * @param {nb.S3Request} req
 * @returns {object}
 */
function _parse_encryption_headers(req) {
    const algorithm = req.headers['x-amz-server-side-encryption'];
    const key_b64 = req.headers[`x-amz-server-side-encryption-key`];
    const key_md5_b64 = req.headers[`x-amz-server-side-encryption-key-md5`];
    if (algorithm || key_b64 || key_md5_b64) {
        dbg.error('get_object_attributes: The x-amz-server-side-encryption header is used on' +
            'PUT object and it is not valid for GET request');
        throw new S3Error(S3Error.BadRequest);
    }
    const encryption_customer = s3_utils.parse_sse_c(req);
    return encryption_customer;
}

/**
 * _parse_attributes parses the header in which the attributes are passed as tring with ',' as separator
 * and returns array with the the attributes according to the valid attributes list (otherwise it throws an error)
 * @param {nb.S3Request} req
 * @returns {string[]}
 */
function _parse_attributes(req) {
    const attributes_str = req.headers['x-amz-object-attributes'];
    if (!attributes_str) {
        dbg.error('get_object_attributes: must pass at least one attribute from:',
            s3_utils.OBJECT_ATTRIBUTES);
        throw new S3Error(S3Error.InvalidArgument);
    }
    const attributes = attributes_str.split(',');
    const all_valid = attributes.every(item => s3_utils.OBJECT_ATTRIBUTES.includes(item));
    if (!all_valid) {
        dbg.error('get_object_attributes: received attributes:', attributes,
            'at least one of the attributes is not from:', s3_utils.OBJECT_ATTRIBUTES);
        throw new S3Error(S3Error.InvalidArgument);
    }
    return attributes;
}

/**
 * _parse_reply_according_to_attributes currently the reply is md_object
 * and we return the properties according to the attributes the client asked for
 * @param {object} reply
 * @param {object} attributes
 * @returns {object}
 */
function _parse_reply_according_to_attributes(reply, attributes) {
    const reply_without_filter = {
        ETag: `"${reply.etag}"`,
        // Checksum: '', // GAP
        // ObjectParts: '', // GAP
        StorageClass: reply.storage_class,
        ObjectSize: reply.size
    };
    const filtered_reply = {
        GetObjectAttributesOutput: {
        }
    };
    for (const key of attributes) {
        if (key in reply_without_filter) {
            filtered_reply.GetObjectAttributesOutput[key] = reply_without_filter[key];
        }
    }
    return filtered_reply;
}

module.exports = {
    handler: get_object_attributes,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'xml',
    },
};
