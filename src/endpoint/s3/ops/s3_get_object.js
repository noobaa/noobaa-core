/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
 */
async function get_object(req, res) {

    const agent_header = req.headers['user-agent'];
    const noobaa_trigger_agent = agent_header && agent_header.includes('exec-env/NOOBAA_FUNCTION');
    const encryption = s3_utils.parse_encryption(req);
    let multipart_number;
    // If set, S3 part number should be positive integer from 1 to 10000
    if (req.query.partNumber) {
        multipart_number = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    }
    const md_conditions = http_utils.get_md_conditions(req);

    const md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        md_conditions,
        encryption,
    };
    if (req.query.get_from_cache !== undefined) {
        md_params.get_from_cache = true;
    }
    if (multipart_number) {
        md_params.multipart_number = multipart_number;
    }
    const object_md = await req.object_sdk.read_object_md(md_params);

    s3_utils.set_response_object_md(res, object_md);
    s3_utils.set_encryption_response_headers(req, res, object_md.encryption);
    const obj_size = object_md.size;
    const params = {
        object_md,
        obj_id: object_md.obj_id,
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: object_md.content_type,
        noobaa_trigger_agent,
        md_conditions,
        encryption,
    };
    if (md_params.get_from_cache) {
        params.get_from_cache = true;
    }
    if (multipart_number) {
        params.multipart_number = multipart_number;
    }
    try {
        // A 'ranged' GET is performed if a  "part number"
        // is specified in the S3 ObjectGET query or alternatively,
        // ranges could be specified in HTTP header
        const range = s3_utils.get_object_range(req, object_md);

        // If range is specified, set it in HTTP response headers
        if (range) {
            params.start = range.start;
            params.end = range.end;
            s3_utils.set_range_response_headers(req, res, range, obj_size);
        } else {
            dbg.log1('reading object', req.path, obj_size);
        }
    } catch (err) {
        if (err.ranges_code === 400) {
            // return http 400 Bad Request
            dbg.log1('bad range request', req.headers.range, req.path, obj_size);
            throw new S3Error(S3Error.InvalidArgument);
        }
        if (err.ranges_code === 416) {
            // return http 416 Requested Range Not Satisfiable
            dbg.warn('invalid range', req.headers.range, req.path, obj_size);
            // let the client know of the relevant range
            res.setHeader('Content-Range', 'bytes */' + obj_size);
            throw new S3Error(S3Error.InvalidRange);
        }
        throw err;
    }
    // first_range_data are the first 4K data of the object
    // if the object's size or the end of range is smaller than 4K return it, else get the whole object
    if (params.object_md.first_range_data) {
        const start = Number(params.start) || 0;
        const end = params.end === undefined ? params.object_md.size : Math.min(params.end, params.object_md.size);
        if (params.object_md.first_range_data.length >= end) {
            const sliced_data = params.object_md.first_range_data.slice(start, end);
            res.end(sliced_data);
            return;
        }
    }

    let read_stream;

    // on http disconnection close the read stream to stop from buffering more data
    req.on('aborted', () => {
        dbg.log0('request aborted:', req.path);
        if (read_stream && read_stream.close) read_stream.close();
    });
    res.on('error', err => {
        dbg.log0('response error:', err, req.path);
        if (read_stream && read_stream.close) read_stream.close();
    });

    read_stream = await req.object_sdk.read_object_stream(params, res);
    if (read_stream) {
        read_stream.on('error', err => {
            dbg.log0('read stream error:', err, req.path);
            res.destroy(err);
        });
        read_stream.pipe(res);
    }

}


function get_bucket_usage(req, res) {
    return {
        bucket: req.params.bucket,
        access_key: req.object_sdk.get_auth_token().access_key,
        read_bytes: res.getHeader('Content-Length'),
        read_count: 1,
    };
}

module.exports = {
    handler: get_object,
    get_bucket_usage,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'raw',
    },
};
