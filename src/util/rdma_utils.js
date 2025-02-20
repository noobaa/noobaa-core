/* Copyright (C) 2025 NooBaa */
'use strict';

const querystring = require('querystring');

const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const http_utils = require('./http_utils');
const nb_native = require('./nb_native');
const { S3Error } = require('../endpoint/s3/s3_errors');
const { S3 } = require('@aws-sdk/client-s3');

const X_NOOBAA_RDMA = 'x-noobaa-rdma'; // both a request header and a response header

/**
 * @param {querystring.ParsedUrlQueryInput} info
 * @returns {string}
 */
function encode_rdma_header(info) {
    return querystring.stringify({
        v: 1,
        ...info,
    });
}

/**
 * @param {string} header
 * @returns {querystring.ParsedUrlQueryInput}
*/
function decode_rdma_header(header) {
    const info = querystring.parse(header);
    if (info.v !== '1') {
        dbg.error('decode_rdma_header: mismatching rdma version', info.v, 'expected 1');
        throw new S3Error(S3Error.InvalidArgument);
    }
    return info;
}

/**
 * @param {import('http').OutgoingHttpHeaders} req_headers
 * @param {nb.RdmaInfo|undefined} rdma_info
 */
function set_rdma_request_header(req_headers, rdma_info) {
    if (!rdma_info) return;
    const h = encode_rdma_header({ ...rdma_info });
    req_headers[X_NOOBAA_RDMA] = h;
}

/**
 * @param {nb.S3Request|undefined} req
 * @param {nb.S3Response} res
 * @param {nb.RdmaInfo|undefined} rdma_info
 * @param {nb.RdmaReply|undefined} rdma_reply
 */
function set_rdma_response_header(req, res, rdma_info, rdma_reply) {
    if (!rdma_info || !rdma_reply) return;
    const h = encode_rdma_header({ ...rdma_reply });
    res.setHeader(X_NOOBAA_RDMA, h);
}

/**
 * @param {nb.S3Request} req
 * @returns {nb.RdmaInfo|undefined}
 */
function parse_rdma_info(req) {
    const header = http_utils.hdr_as_str(req.headers, X_NOOBAA_RDMA);
    if (!header) return;
    try {
        const info = decode_rdma_header(header);
        const rdma_info = {
            desc: String(info.desc),
            addr: String(info.addr),
            size: Number(String(info.size)),
            offset: Number(String(info.offset || '0')),
        };
        return rdma_info;
    } catch (err) {
        dbg.warn('parse_rdma_info: failed to parse header', header, err);
        throw new S3Error(S3Error.InvalidArgument);
    }
}

/**
 * @param {import('http').IncomingHttpHeaders} res_headers
 * @returns {nb.RdmaReply|undefined}
 */
function parse_rdma_reply(res_headers) {
    const header = http_utils.hdr_as_str(res_headers, X_NOOBAA_RDMA);
    if (!header) return;
    try {
        const info = decode_rdma_header(header);
        const rdma_reply = {
            size: Number(String(info.size)),
        };
        return rdma_reply;
    } catch (err) {
        dbg.warn('parse_rdma_reply: failed to parse header', header, err);
        throw new S3Error(S3Error.InvalidArgument);
    }
}

/////////////////
// RDMA SERVER //
/////////////////

let _rdma_server = null;

/**
 * @param {nb.RdmaInfo} rdma_info
 * @returns {nb.RdmaServerNapi}
 */
function s3_rdma_server(rdma_info) {
    if (!config.RDMA_ENABLED) {
        throw new Error('RDMA is not enabled');
    }
    if (_rdma_server) return _rdma_server;
    const { RdmaServerNapi } = nb_native();
    const ip = '172.16.0.61';
    _rdma_server = new RdmaServerNapi({
        ip,
        port: 0, // every fork will get a different port
        log_level: 'ERROR',
    });
    console.log('RDMA server:', ip);
    return _rdma_server;
}

/**
 * Server side RDMA operation to write a buffer from remote server to local file
 * Use buffer pool to get buffer of the required size.
 * 
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_writer')} writer
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @returns {Promise<nb.RdmaReply|undefined>}
 */
async function write_file_from_rdma(rdma_info, writer, multi_buffer_pool) {
    // TODO handle abort signal
    // TODO iterate offsets if cannot write all at once
    const rdma_server = await s3_rdma_server(rdma_info);
    // console.log('GGG rdma_info', rdma_info);
    return await multi_buffer_pool
        .get_buffers_pool(rdma_info.size)
        .use_buffer(async buffer => {
            if (buffer.length < rdma_info.size) {
                throw new Error('Buffer too small for rdma PUT');
            }
            rdma_server.register_buffer(buffer);
            // console.log('GGG registered', buffer);
            const ret_size = await rdma_server.rdma('PUT', 'FileWriter', buffer, rdma_info);
            // console.log('GGG ret_size', ret_size);
            await writer.write_buffers([buffer], ret_size);
            await writer.finalize();
            // console.log('GGG writer.total_bytes', writer.total_bytes);
            return { size: ret_size };
        });
}

/**
 * @param {nb.RdmaInfo} rdma_info
 * @param {import ('./file_reader').FileReader} reader
 * @param {import ('./buffer_utils').MultiSizeBuffersPool} multi_buffer_pool
 * @returns {Promise<number>}
 */
async function read_file_to_rdma(rdma_info, reader, multi_buffer_pool) {
    // TODO handle abort signal
    // TODO iterate offsets if cannot read all at once
    const rdma_server = await s3_rdma_server(rdma_info);
    return await multi_buffer_pool
        .get_buffers_pool(rdma_info.size)
        .use_buffer(async buffer => {
            if (buffer.length > rdma_info.size) {
                throw new Error('Buffer too large for rdma GET');
            }
            // console.log('GGG use_buffer');
            rdma_server.register_buffer(buffer);
            // console.log('GGG registered', buffer);
            // const nread = 
            await reader.read_into_buffer(buffer, 0, buffer.length);
            // console.log('GGG read_into_buffer', read_size);
            const ret_size = await rdma_server.rdma('GET', reader.file_path, buffer, rdma_info);
            // console.log('GGG rdma', ret_size);
            return ret_size;
        });
}


/////////////////
// RDMA CLIENT //
/////////////////

/**
 * @param {import('@aws-sdk/client-s3').S3ClientConfig} s3_config
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} [rdma_client]
 * @returns {S3}
 */
function s3_rdma_client(s3_config, client_buf, rdma_client) {
    const s3 = new S3(s3_config);
    s3.middlewareStack.use(s3_rdma_client_plugin(client_buf));
    return s3;
}

/**
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} [rdma_client]
 * @returns {import('@smithy/types').Pluggable} 
 */
function s3_rdma_client_plugin(client_buf, rdma_client) {
    return {
        applyToStack: stack => {
            stack.add(s3_rdma_client_middleware(client_buf), {
                name: 'rdma',
                step: 'build',
            });
        }
    };
}

/**
 * @param {Buffer} client_buf
 * @param {nb.RdmaClientNapi} [rdma_client]
 * @returns {import('@smithy/types').BuildMiddleware} 
 */
function s3_rdma_client_middleware(client_buf, rdma_client) {
    rdma_client ||= new (nb_native().RdmaClientNapi)();
    return (next, context) => async args => {
        /** @type {any} */
        const input = args.input;
        /** @type {any} */
        const request = args.request;
        /** @type {any} */
        let result;

        // console.log('S3 RDMA: build', request, input);

        /** @type {'GET'|'PUT'} */
        let req_type = 'GET';
        /** @type {Buffer} */
        let rdma_buf;

        if (context.commandName === 'GetObjectCommand') {
            req_type = 'GET';
            rdma_buf = client_buf;
        } else if (context.commandName === 'PutObjectCommand') {
            req_type = 'PUT';
            rdma_buf = client_buf;
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else if (context.commandName === 'UploadPartCommand') {
            req_type = 'PUT';
            rdma_buf = client_buf;
            // rdma_buf = input.Body; // TODO handle other body types?
            input.Body = undefined;
            request.headers['content-length'] = '0';
        } else {
            return next(args);
        }

        const ret_size = await rdma_client.rdma(
            req_type, rdma_buf, async (rdma_info, callback) => {
                try {
                    set_rdma_request_header(request.headers, rdma_info);
                    // console.log('S3 RDMA: request', request.headers);
                    result = await next(args);
                    // console.log('S3 RDMA: response', result.response.headers);
                    const rdma_reply = parse_rdma_reply(result.response.headers);
                    result.output.rdma_reply = rdma_reply;
                    callback(null, Number(rdma_reply.size));
                } catch (err) {
                    console.warn('S3 RDMA: Received error from server', err);
                    callback(err);
                }
            }
        );

        if (ret_size < 0) {
            console.log('S3 RDMA: Return', ret_size, req_type, rdma_buf.length);
        }

        return result;
    };
}


// EXPORTS
exports.X_NOOBAA_RDMA = X_NOOBAA_RDMA;
exports.encode_rdma_header = encode_rdma_header;
exports.decode_rdma_header = decode_rdma_header;
exports.set_rdma_request_header = set_rdma_request_header;
exports.set_rdma_response_header = set_rdma_response_header;
exports.parse_rdma_info = parse_rdma_info;
exports.parse_rdma_reply = parse_rdma_reply;
// SERVER
exports.s3_rdma_server = s3_rdma_server;
exports.write_file_from_rdma = write_file_from_rdma;
exports.read_file_to_rdma = read_file_to_rdma;
// CLIENT
exports.s3_rdma_client = s3_rdma_client;
exports.s3_rdma_client_plugin = s3_rdma_client_plugin;
exports.s3_rdma_client_middleware = s3_rdma_client_middleware;
