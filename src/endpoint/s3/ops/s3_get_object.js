/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
 */
function get_object(req, res) {
    const read_md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    };
    if ('versionId' in req.query) {
        read_md_params.version_id = req.query.versionId === 'null' ? null : req.query.versionId;
    }
    return req.object_sdk.read_object_md(read_md_params)
        .then(object_md => {
            s3_utils.set_response_object_md(res, object_md);
            const obj_size = object_md.size;
            const params = {
                object_md,
                obj_id: object_md.obj_id,
                bucket: req.params.bucket,
                key: req.params.key,
            };

            // ranges:
            //      undefined (no range)
            //      400 (invalid syntax)
            //      416 (unsatisfiable)
            //      array (ranges)
            const ranges = http_utils.normalize_http_ranges(
                http_utils.parse_http_range(req.headers.range),
                obj_size);

            if (!ranges) {
                // stream the entire object to the response
                dbg.log1('reading object', req.path, obj_size);
                return req.object_sdk.read_object_stream(params);
            }

            // return http 400 Bad Request
            if (ranges === 400) {
                dbg.log1('bad range request', req.headers.range, req.path, obj_size);
                throw new S3Error(S3Error.InvalidArgument);
            }

            // return http 416 Requested Range Not Satisfiable
            if (ranges === 416) {
                dbg.warn('invalid range', req.headers.range, req.path, obj_size);
                // let the client know of the relevant range
                res.setHeader('Content-Range', 'bytes */' + obj_size);
                throw new S3Error(S3Error.InvalidRange);
            }

            // reply with HTTP 206 Partial Content
            res.statusCode = 206;
            params.start = ranges[0].start;
            params.end = ranges[0].end + 1; // use exclusive end
            const content_range = `bytes ${params.start}-${params.end - 1}/${obj_size}`;
            dbg.log1('reading object range', req.path, content_range, ranges);
            res.setHeader('Content-Range', content_range);
            res.setHeader('Content-Length', params.end - params.start);
            // res.header('Cache-Control', 'max-age=0' || 'no-cache');
            return req.object_sdk.read_object_stream(params);

        })
        .then(read_stream => {
            if (!read_stream) {
                res.end();
                return;
            }
            // on http disconnection close the read stream to stop from buffering more data
            req.on('aborted', () => {
                dbg.log0('request aborted:', req.path);
                if (read_stream.close) read_stream.close();
            });
            res.on('error', err => {
                dbg.log0('response error:', err, req.path);
                if (read_stream.close) read_stream.close();
            });
            read_stream.pipe(res);
        });
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
