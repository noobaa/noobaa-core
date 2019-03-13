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
async function get_blob(req, res) {
    const get_range_md5 = req.headers['x-ms-range-get-content-md5'] === 'true';

    const object_md = await req.object_sdk.read_object_md({
        bucket: req.params.bucket,
        key: req.params.key,
        md_conditions: http_utils.get_md_conditions(req),
    });

    blob_utils.set_response_object_md(res, object_md);
    if (req.method === 'HEAD') {
        // head response does not send body
        res.end();
        return;
    }

    const obj_size = object_md.size;
    const params = {
        object_md,
        obj_id: object_md.obj_id,
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: object_md.content_type
    };

    try {
        const range_header = req.headers['x-ms-range'] || req.headers.range;
        const ranges = http_utils.normalize_http_ranges(
            http_utils.parse_http_ranges(range_header),
            obj_size
        );
        if (ranges) {
            // reply with HTTP 206 Partial Content
            params.start = ranges[0].start;
            params.end = ranges[0].end;
            const range_size = params.start - params.end;
            const MAX_RANGE_SIZE_TO_MD5 = 4 * 1024 * 1024;
            const content_range = `bytes ${params.start}-${params.end - 1}/${obj_size}`;
            dbg.log1('reading object range', req.path, content_range, ranges);
            res.setHeader('Content-Range', content_range);
            res.setHeader('Content-Length', params.end - params.start);
            // res.header('Cache-Control', 'max-age=0' || 'no-cache');
            if (get_range_md5 && range_size > MAX_RANGE_SIZE_TO_MD5) {
                throw new BlobError(BlobError.OutOfRangeQueryParameterValue);
            }
            res.statusCode = 206;
        } else {
            if (get_range_md5) throw new BlobError(BlobError.InvalidHeaderValue);
            if (object_md.md5_b64) res.setHeader('Content-MD5', object_md.md5_b64);
            // stream the entire object to the response
            dbg.log1('reading object', req.path, obj_size);
        }
    } catch (err) {
        if (err.ranges_code === 400) {
            dbg.log1('bad range request', req.headers.range, req.path, obj_size);
            throw new BlobError(BlobError.InvalidArgument);
        }
        if (err.ranges_code === 416) {
            dbg.warn('invalid range', req.headers.range, req.path, obj_size);
            // let the client know of the relevant range
            res.setHeader('Content-Range', 'bytes */' + obj_size);
            throw new BlobError(BlobError.InvalidRange);
        }
        throw err;
    }

    // TODO: Read triggers can be recursive if used with blob_rest since we do not mark the user-agent
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
