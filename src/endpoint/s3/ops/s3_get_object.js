/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const http_utils = require('../../../util/http_utils');
const rdma_utils = require('../../../util/rdma_utils');

/* eslint-disable max-statements */

/**
 * http://docs.aws.amazon.com/AmazonS3/latest/API/RESTObjectGET.html
 * @param {nb.S3Request} req
 * @param {nb.S3Response} res
 */
async function get_object(req, res) {

    req.object_sdk.setup_abort_controller(req, res);
    const agent_header = req.headers['user-agent'];
    const noobaa_trigger_agent = agent_header && agent_header.includes('exec-env/NOOBAA_FUNCTION');
    const encryption = s3_utils.parse_encryption(req);
    const version_id = s3_utils.parse_version_id(req.query.versionId);
    const rdma_info = rdma_utils.parse_rdma_info(req);
    let part_number;
    // If set, part_number should be positive integer from 1 to 10000
    if (req.query.partNumber) {
        part_number = s3_utils.parse_part_number(req.query.partNumber, S3Error.InvalidArgument);
    }
    const md_conditions = http_utils.get_md_conditions(req);

    const md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id,
        md_conditions,
        encryption,
    };
    if (req.query.get_from_cache !== undefined) {
        md_params.get_from_cache = true;
    }
    if (part_number) {
        md_params.part_number = part_number;
    }

    const object_md = await req.object_sdk.read_object_md(md_params);

    s3_utils.set_response_object_md(res, object_md);
    s3_utils.set_encryption_response_headers(req, res, object_md.encryption);
    if (s3_utils.GLACIER_STORAGE_CLASSES.includes(object_md.storage_class)) {
        if (object_md.restore_status?.ongoing || !object_md.restore_status?.expiry_time) {
            // Don't try to read the object if it's not restored yet
            dbg.warn('Object is not restored yet', req.path, object_md.restore_status);
            throw new S3Error(S3Error.InvalidObjectState);
        }
    }
    http_utils.set_response_headers_from_request(req, res);
    if (!version_id) await http_utils.set_expiration_header(req, res, object_md); // setting expiration header for bucket lifecycle
    const obj_size = object_md.size;
    const params = {
        object_md,
        obj_id: object_md.obj_id,
        bucket: req.params.bucket,
        key: req.params.key,
        version_id,
        content_type: object_md.content_type,
        noobaa_trigger_agent,
        md_conditions,
        encryption,
        rdma_info,
    };

    if (md_params.get_from_cache) {
        params.get_from_cache = true;
    }
    if (part_number) {
        params.part_number = part_number;
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

    const read_stream = await req.object_sdk.read_object_stream(params, res);
    if (read_stream) {
        // if read_stream supports closing, then we handle abort cases such as http disconnection
        // by calling the close method to stop it from buffering more data which will go to waste.
        req.object_sdk.add_abort_handler(() => {
            read_stream.destroy(new Error('abort read stream'));
        });
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
