/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const BlobError = require('../blob_errors').BlobError;
const blob_utils = require('../blob_utils');
const http_utils = require('../../../util/http_utils');
const crypto = require('crypto');

// TODO merge code with s3_get_object

/**
 * HEAD : https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob-properties
 * GET  : https://docs.microsoft.com/en-us/rest/api/storageservices/get-blob
 */
function get_blob(req, res) {
    const get_range_md5 = req.headers['x-ms-range-get-content-md5'] === 'true';

    return req.object_sdk.read_object_md({
            bucket: req.params.bucket,
            key: req.params.key,
            md_conditions: http_utils.get_md_conditions(req),
        })
        .then(object_md => {
            blob_utils.set_response_object_md(res, object_md);
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
                if (get_range_md5) throw new BlobError(BlobError.InvalidHeaderValue);
                if (object_md.md5_b64) res.setHeader('Content-MD5', object_md.md5_b64);
                if (req.method === 'HEAD') return;
                // stream the entire object to the response
                dbg.log1('reading object', req.path, obj_size);
                return req.object_sdk.read_object_stream(params);
            }

            // return http 400 Bad Request
            if (ranges === 400) {
                dbg.log1('bad range request', req.headers.range, req.path, obj_size);
                throw new BlobError(BlobError.InvalidArgument);
            }

            // return http 416 Requested Range Not Satisfiable
            if (ranges === 416) {
                dbg.warn('invalid range', req.headers.range, req.path, obj_size);
                // let the client know of the relevant range
                res.setHeader('Content-Range', 'bytes */' + obj_size);
                throw new BlobError(BlobError.InvalidRange);
            }

            // reply with HTTP 206 Partial Content
            params.start = ranges[0].start;
            params.end = ranges[0].end + 1; // use exclusive end
            const range_size = params.start - params.end;
            const FOUR_MB_IN_BYTES = 4 * 1024 * 1024;
            const content_range = `bytes ${params.start}-${params.end - 1}/${obj_size}`;
            dbg.log1('reading object range', req.path, content_range, ranges);
            res.setHeader('Content-Range', content_range);
            res.setHeader('Content-Length', params.end - params.start);
            // res.header('Cache-Control', 'max-age=0' || 'no-cache');

            if (req.method === 'HEAD') return;
            if (get_range_md5 && range_size > FOUR_MB_IN_BYTES) {
                throw new BlobError(BlobError.OutOfRangeQueryParameterValue);
            }
            res.statusCode = 206;
            return req.object_sdk.read_object_stream(params);

        })
        .then(read_stream => {
            if (!read_stream) {
                // head response does not send body
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

            if (get_range_md5) {
                const buffers = [];
                const hash = crypto.createHash('md5');
                read_stream.on('data', data => {
                    buffers.push(data);
                    hash.update(data);
                });
                read_stream.on('end', () => {
                    res.setHeader('Content-MD5', hash.digest('base64'));
                    for (const data of buffers) {
                        res.write(data);
                    }
                    res.end();
                });
            } else {
                read_stream.pipe(res);
            }
        });
}


module.exports = {
    handler: get_blob,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'raw',
    },
};
