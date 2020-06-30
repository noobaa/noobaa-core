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

    const md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        md_conditions: http_utils.get_md_conditions(req),
        encryption
    };
    if (req.query.get_from_cache !== undefined) {
        md_params.get_from_cache = true;
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
        encryption,
    };
    if (md_params.get_from_cache) {
        params.get_from_cache = true;
    }
    try {
        const ranges = http_utils.normalize_http_ranges(
            http_utils.parse_http_ranges(req.headers.range),
            obj_size
        );
        if (ranges) {
            // reply with HTTP 206 Partial Content
            res.statusCode = 206;
            params.start = ranges[0].start;
            params.end = ranges[0].end;
            const content_range = `bytes ${params.start}-${params.end - 1}/${obj_size}`;
            dbg.log1('reading object range', req.path, content_range, ranges);
            res.setHeader('Content-Range', content_range);
            res.setHeader('Content-Length', params.end - params.start);
            // res.header('Cache-Control', 'max-age=0' || 'no-cache');
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
    const read_stream = await req.object_sdk.read_object_stream(params);

    // on http disconnection close the read stream to stop from buffering more data
    req.on('aborted', () => {
        dbg.log0('request aborted:', req.path);
        if (read_stream.close) read_stream.close();
    });
    res.on('error', err => {
        dbg.log0('response error:', err, req.path);
        if (read_stream.close) read_stream.close();
    });
    read_stream.on('error', err => {
        dbg.log0('read stream error:', err, req.path);
        res.destroy(err);
    });
    read_stream.pipe(res);

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
