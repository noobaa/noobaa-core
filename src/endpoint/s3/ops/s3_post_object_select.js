/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const S3Error = require('../s3_errors').S3Error;
const s3_utils = require('../s3_utils');
const { S3SelectStream } = require('../../../util/s3select');
const nb_native = require('../../../util/nb_native');
const stream_utils = require('../../../util/stream_utils');
const NamespaceFS = require('../../../sdk/namespace_fs');
const input_format_CSV = 'CSV';
const input_format_JSON = 'JSON';
const input_format_Parquet = 'Parquet';
/**
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_SelectObjectContent.html
 */
async function post_object_select(req, res) {

    if (!nb_native().S3Select) {
        throw new S3Error(S3Error.S3SelectNotCompiled);
    }
    if (req?.body?.SelectObjectContentRequest?.InputSerialization[0]?.Parquet && !nb_native()?.select_parquet) {
        throw new S3Error(S3Error.S3SelectParquetNotCompiled);
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
        version_id: req.query.versionId,
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

    /**@type {nb.select_input_format} */
    let input_format;
    if (input_serialization.CSV) {
        input_format = input_format_CSV;
    } else if (input_serialization.JSON) {
        input_format = input_format_JSON;
    } else if (input_serialization.Parquet) {
        input_format = input_format_Parquet;
    } else {
        throw new S3Error(S3Error.MissingInputSerialization);
    }

    //currently s3select can only output in the same format as input format
    if (Array.isArray(http_req_select_params.OutputSerialization)) {
        const output_serialization = http_req_select_params.OutputSerialization[0];
        if ((input_format === input_format_CSV && !output_serialization.CSV) ||
            (input_format === input_format_JSON && !output_serialization.JSON) ||
            (input_format === input_format_Parquet && !output_serialization.CSV)) {
                throw new S3Error(S3Error.OutputInputFormatMismatch);
            }
    }

    dbg.log3("input_serialization = ", input_serialization);

    /**@type {nb.S3SelectOptions} */
    const select_args = {
        query: http_req_select_params.Expression[0],
        input_format: input_format,
        input_serialization_format: http_req_select_params.InputSerialization[0][input_format][0], //can be more lenient
        records_header_buf: S3SelectStream.records_message_headers,
        size_bytes: object_md.size,
        filepath: undefined,
        fs_context: undefined
    };
    //extra args for parquet file
    if (input_format === input_format_Parquet) {
        //get the filepath
        const nsfs = await req.object_sdk._get_bucket_namespace(params.bucket);
        if (!(nsfs instanceof NamespaceFS)) {
            throw new S3Error(S3Error.NotImplemented);
        }
        const fs_context = nsfs.prepare_fs_context(req.object_sdk);
        const filepath = await nsfs._find_version_path(fs_context, params);
        dbg.log2("FILEPATH nsfs = ", filepath);
        select_args.filepath = filepath;
        select_args.fs_context = fs_context;
    }
    const s3select = new S3SelectStream(select_args);
    dbg.log2("select_args = ", select_args);

    s3select.on('error', err => {
        dbg.error("s3select error:", err, ", for path = ", req.path);
        res.end(S3SelectStream.error_message);
    });

    //pipe s3select result into http result
    stream_utils.pipeline([s3select, res], true /*res is a write stream, no need for resume*/);

    if (input_format === 'Parquet') {
        //Parquet is not streamed. Instead the s3select will read
        //whatever parts of the file that are required for the query
        await s3select.select_parquet();
    } else {
        //send s3select pipe to read_object_stream.
        //in some cases (currently nsfs) it will pipe object stream into our pipe (s3select)
        const read_stream = await req.object_sdk.read_object_stream(params, s3select);
        if (read_stream) {
            // if read_stream supports closing, then we handle abort cases such as http disconnection
            // by calling the close method to stop it from buffering more data which will go to waste.
            if (read_stream.close) {
                req.object_sdk.add_abort_handler(() => read_stream.close());
            }
            //in other cases, we need to pipe the read stream ourselves
            stream_utils.pipeline([read_stream, s3select], true /*no need to resume s3select*/);
        }
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
