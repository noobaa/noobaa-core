/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const { S3SelectStream } = require('../../../util/s3select');
const nb_native = require('../../../util/nb_native');
const stream_utils = require('../../../util/stream_utils');

/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_SelectObjectContent.html
 */
async function post_object_select(req, res) {

    if (!nb_native().S3Select) {
        throw new S3Error(S3Error.S3SelectNotCompiled);
    }

    req.object_sdk.setup_abort_controller(req, res);
    const agent_header = req.headers['user-agent'];
    const noobaa_trigger_agent = agent_header && agent_header.includes('exec-env/NOOBAA_FUNCTION');
    const encryption = s3_utils.parse_encryption(req);
    const http_req_select_params = req.body.SelectObjectContentRequest;

    const md_params = {
        bucket: req.params.bucket,
        key: req.params.key,
        version_id: req.query.versionId,
        encryption,
    };
    const object_md = await req.object_sdk.read_object_md(md_params);

    const params = {
        object_md,
        obj_id: object_md.obj_id,
        bucket: req.params.bucket,
        key: req.params.key,
        content_type: object_md.content_type,
        noobaa_trigger_agent,
        encryption,
    };

    //handle ScanRange
    if (Array.isArray(http_req_select_params.ScanRange)) {
        const scan_range = http_req_select_params.ScanRange[0];
        if (scan_range.Start) {
            params.start = Number(scan_range.Start);
        }
        if (scan_range.End) {
            if (scan_range.Start) {
                params.end = Number(scan_range.End);
            } else {
                //if only End is specified, start from {End} bytes from the end.
                params.start = object_md.size - (Number(scan_range.End));
            }
        }
    }

    //prepare s3select stream
    const input_serialization = http_req_select_params.InputSerialization[0];
    let input_format = null;
    if (input_serialization.CSV) {
        input_format = 'CSV';
    } else if (input_serialization.JSON) {
        input_format = 'JSON';
    } else {
        throw new S3Error(S3Error.MissingInputSerialization);
    }

    //currently s3select can only output in the same format as input format
    if (Array.isArray(http_req_select_params.OutputSerialization)) {
        const output_serialization = http_req_select_params.OutputSerialization[0];
        if ((output_serialization.CSV && input_format !== 'CSV') ||
            (output_serialization.JSON && input_format !== 'JSON')) {
                throw new S3Error(S3Error.OutputInputFormatMismatch);
            }
    }

    const select_args = {
        query: http_req_select_params.Expression[0],
        input_format: input_format,
        input_serialization_format: http_req_select_params.InputSerialization[0][input_format][0],
        records_header_buf: S3SelectStream.records_message_headers
    };
    const s3select = new S3SelectStream(select_args);
    dbg.log3("select_args = ", select_args);

    //pipe s3select result into http result
    stream_utils.pipeline([s3select, res], true /*res is a write stream, no need for resume*/);

    //send s3select pipe to read_object_stream.
    //in some cases (currently nsfs) it will pipe object stream into our pipe (s3select)
    const read_stream = await req.object_sdk.read_object_stream(params, s3select);
    if (read_stream) {
        // if read_stream supports closing, then we handle abort cases such as http disconnection
        // by calling the close method to stop it from buffering more data which will go to waste.
        req.object_sdk.add_abort_handler(() => {
            read_stream.destroy(new Error('abort read stream'));
        });
        read_stream.on('error', err => {
            dbg.error('read stream error:', err, req.path);
            res.destroy(err);
        });
        //in other cases, we need to pipe the read stream ourselves
        stream_utils.pipeline([read_stream, s3select], true /*no need to resume s3select*/);
    }
}

module.exports = {
    handler: post_object_select,
    body: {
        type: 'xml',
    },
    reply: {
        type: 'raw',
    },
};
