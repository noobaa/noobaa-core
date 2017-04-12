/* Copyright (C) 2016 NooBaa */
'use strict';

const stream = require('stream');

const dbg = require('../../../util/debug_module')(__filename);
const BlobError = require('../blob_errors').BlobError;
const http_utils = require('../../../util/http_utils');
const blob_head_blob = require('./blob_head_blob');

// TODO merge code with s3_get_object

function get_blob(req, res) {
    return blob_head_blob.handler(req, res)
        .then(() => {
            const object_md = req.object_md;
            const obj_size = object_md.size;
            const params = {
                client: req.rpc_client,
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

            // stream the entire object to the response
            if (!ranges) {
                dbg.log1('reading object', req.path, obj_size);
                stream_reply(req, res, req.object_io.create_read_stream(params));
                return;
            }

            // reply with HTTP 206 Partial Content
            res.statusCode = 206;
            const start = ranges[0].start;
            const end = ranges[0].end + 1; // use exclusive end
            const range_params = Object.assign({ start, end }, params);
            const content_range = `bytes ${start}-${end - 1}/${obj_size}`;
            dbg.log1('reading object range', req.path, content_range, ranges);
            res.setHeader('Content-Range', content_range);
            res.setHeader('Content-Length', end - start);
            // res.header('Cache-Control', 'max-age=0' || 'no-cache');
            stream_reply(req, res, req.object_io.create_read_stream(range_params));

            // when starting to stream also prefrech the last part of the file
            // since some video encodings put a chunk of video metadata in the end
            // and it is often requested once doing a video time seek.
            // see https://trac.ffmpeg.org/wiki/Encode/H.264#faststartforwebvideo
            if (start === 0 &&
                obj_size > 1024 * 1024 &&
                object_md.content_type.startsWith('video')) {
                dbg.log1('prefetch end of object', req.path, obj_size);
                const prefetch_params = Object.assign({
                    start: obj_size - 100,
                    end: obj_size,
                }, params);
                // a writable sink that ignores the data
                // just to pump the data through the cache
                const dev_null = new stream.Writable({ write: discard_stream_writer });
                req.object_io.create_read_stream(prefetch_params).pipe(dev_null);
            }
        });
}

function stream_reply(req, res, read_stream) {
    // on http disconnection close the read stream to stop from buffering more data
    req.on('aborted', () => {
        dbg.log0('request aborted:', req.path);
        read_stream.close();
    });
    res.on('error', err => {
        dbg.log0('response error:', err, req.path);
        read_stream.close();
    });
    read_stream.pipe(res);
}

function discard_stream_writer(chunk, encoding, next) {
    next();
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
