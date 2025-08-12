/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');
const config = require('../../../../../config');
const http_utils = require('../../../../util/http_utils');
const buffer_utils = require('../../../../util/buffer_utils');
const dbg = require('../../../../util/debug_module')(__filename);
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { S3Error } = require('../../../../endpoint/s3/s3_errors');
const { require_coretest, is_nc_coretest } = require('../../../system_tests/test_utils');
const { S3Client, PutObjectCommand, ChecksumAlgorithm, CreateMultipartUploadCommand, UploadPartCommand,
  CompleteMultipartUploadCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const coretest = require_coretest();
const { rpc_client, EMAIL, POOL_LIST } = coretest;
coretest.setup({ pools_to_create: is_nc_coretest ? undefined : [POOL_LIST[1]] });

const first_bucket = 'first.bucket';
const default_checksum_algorithm = ChecksumAlgorithm.SHA256;
const non_chunked_upload_key = 'non_chunked_upload.txt';

mocha.describe('S3 basic chunked upload tests', async function() {
    let s3;

    mocha.before(async () => {
        const account_info = await rpc_client.account.read_account({ email: EMAIL, });
        const s3_client_params = {
            endpoint: coretest.get_http_address(),
            credentials: {
                accessKeyId: account_info.access_keys[0].access_key.unwrap(),
                secretAccessKey: account_info.access_keys[0].secret_key.unwrap(),
            },
            forcePathStyle: true,
            region: config.DEFAULT_REGION,
            requestHandler: new NodeHttpHandler({
                httpAgent: http_utils.get_unsecured_agent(coretest.get_http_address()),
            }),
        };
        s3 = new S3Client(s3_client_params);
        await validate_request_headers(s3);
    });

    mocha.it('Put object - chunked upload - no additional content-encoding', async function() {
        const bucket = first_bucket;
        const key = 'chunked_upload.txt';
        const size = 5 * 1024 * 1024; // 5MB minimal for chunked upload
        await test_put_chunked_object({ s3, bucket, key, size });
    });

    mocha.it('Put object - chunked upload - multiple encodings - no spaces - aws-chunked will be added to content-encoding header without spaces by the sdk', async function() {
        const bucket = first_bucket;
        const key = 'chunked_upload_multiple_encodings_no_spaces.txt';
        const content_encoding = 'gzip,zstd';
        const size = 100;
        await test_put_chunked_object({ s3, bucket, key, size, content_encoding });
    });

    mocha.it('Put object - not a chunked upload but having aws-chunked with spaces in encoding header - should fail', async function() {
        const bucket = first_bucket;
        const key = non_chunked_upload_key;
        const content_encoding = 'zstd, gzip, aws-chunked';
        const size = 100;
        try {
            await test_put_chunked_object({ s3, bucket, key, size, content_encoding, chunked_upload: false });
            assert.fail('Put object - not a chunked upload but having aws-chunked in encoding header encoding - should fail');
        } catch (err) {
            dbg.error('error', err);
            // the upload is recognized as a chunked upload because of the added aws-chunked encoding but the content is not chunked - NooBaa throws internal error
            assert.equal(err.Code, S3Error.InternalError.code);
        }
    });

    mocha.it('MPU - chunked upload - no additional content encoding', async function() {
        const bucket = first_bucket;
        const key = 'chunked_upload_mpu.txt';
        const parts_num = 3;
        const size = 5 * 1024 * 1024; // 5MB minimal for chunked upload
        await test_chunked_mpu({ s3, bucket, key, size, parts_num });
    });

    mocha.it('MPU - chunked upload  - multiple encodings - no spaces - aws-chunked will be added to content-encoding header without spaces by the sdk', async function() {
        const bucket = first_bucket;
        const key = 'chunked_upload_mpu_multiple_encodings_no_spaces.txt';
        const content_encoding = 'gzip,zstd';
        const parts_num = 3;
        const size = 5 * 1024 * 1024; // 5MB minimal for chunked upload
        await test_chunked_mpu({ s3, bucket, key, size, parts_num, content_encoding });
    });
});

/**
 * @param {{
 * s3: S3Client,
 * bucket?: string,
 * key: string,
 * size?: number,
 * content_encoding?: string,
 * checksum_algorithm?: ChecksumAlgorithm 
 * chunked_upload?: boolean
 * }} upload_config - Configuration object
 */
async function test_put_chunked_object(upload_config) {
    const { s3, bucket = first_bucket, key, size = 100, chunked_upload = true,
        content_encoding, checksum_algorithm = default_checksum_algorithm } = upload_config;
    const random_data_buffer = crypto.randomBytes(size);
    const random_data_stream = buffer_utils.buffer_to_read_stream(random_data_buffer);
    const body = chunked_upload ? random_data_stream : random_data_buffer;
    const input = {
        Bucket: bucket,
        Key: key,
        ContentLength: size,
        Body: body,
        ContentEncoding: content_encoding,
        ChecksumAlgorithm: chunked_upload ? checksum_algorithm : undefined,
    };
    const put_object_command = new PutObjectCommand(input);
    const put_object_response = await s3.send(put_object_command);
    dbg.log0('PutObject response:', put_object_response);
    assert.ok(put_object_response.ETag);

    const get_object_res = await get_object_buffer(s3, bucket, key);
    assert.ok(random_data_buffer.equals(get_object_res.body), 'Uploaded and downloaded data differ');
    assert.equal(get_object_res.ETag, put_object_response.ETag);

    await delete_object(s3, bucket, key);
}

/**
 * @param {{
 * s3: S3Client,
 * bucket?: string,
 * key: string,
 * size?: number,
 * parts_num?: number,
 * content_encoding?: string,
 * checksum_algorithm?: ChecksumAlgorithm 
 * chunked_upload?: boolean
 * }} mpu_config - Configuration object
 */
async function test_chunked_mpu(mpu_config) {
    const { s3, bucket = first_bucket, key, size = 100, parts_num = 1, chunked_upload = true,
        content_encoding = undefined, checksum_algorithm = default_checksum_algorithm } = mpu_config;

    const create_mpu_input = {
        Bucket: bucket, Key: key, ContentEncoding: content_encoding,
        ChecksumAlgorithm: checksum_algorithm
    };
    const create_mpu_command = new CreateMultipartUploadCommand(create_mpu_input);
    const create_mpu_response = await s3.send(create_mpu_command);
    dbg.log0('MPU create_mpu_response:', create_mpu_response);
    assert.ok(create_mpu_response.UploadId);

    const parts = [];
    let original_buffer = Buffer.alloc(0);
    for (let i = 1; i <= parts_num; i++) {
        const random_data_buffer = crypto.randomBytes(size);
        const random_data_stream = buffer_utils.buffer_to_read_stream(random_data_buffer);
        const body = chunked_upload ? random_data_stream : random_data_buffer;
        const upload_part_input = {
            Bucket: bucket, Key: key, UploadId: create_mpu_response.UploadId,
            PartNumber: i, Body: body, ContentLength: size,
            ContentEncoding: content_encoding,
            ChecksumAlgorithm: chunked_upload ? checksum_algorithm : undefined
        };
        const upload_part_command = new UploadPartCommand(upload_part_input);
        const upload_part_response = await s3.send(upload_part_command);
        dbg.log0('MPU upload_part_response:', upload_part_response);
        assert.ok(upload_part_response.ETag);
        parts.push({ PartNumber: i, ETag: upload_part_response.ETag });
        original_buffer = Buffer.concat([original_buffer, random_data_buffer]);
    }

    const complete_mpu_input = { Bucket: bucket, Key: key, UploadId: create_mpu_response.UploadId, MultipartUpload: { Parts: parts } };
    const complete_mpu_command = new CompleteMultipartUploadCommand(complete_mpu_input);
    const complete_mpu_response = await s3.send(complete_mpu_command);
    dbg.log0('MPU complete_mpu_response:', complete_mpu_response);
    assert.ok(complete_mpu_response.ETag);

    const get_object_res = await get_object_buffer(s3, bucket, key);
    assert.ok(original_buffer.equals(get_object_res.body), 'Uploaded and downloaded data differ');

    await delete_object(s3, bucket, key);
}

/**
 * validate_request_headers - Middleware to log and validate request headers
 * @param {S3Client} s3 
 * @returns {Promise<void>} - Returns the S3 client with the middleware added
 */
async function validate_request_headers(s3) {
    s3.middlewareStack.add(
        (next, context) => async args => {
            const command = context.commandName;
            const object_key = args.input.Key;
            const is_chunked_upload_by_key = object_key !== non_chunked_upload_key;
            const is_upload_command = command === 'PutObjectCommand' || command === 'UploadPartCommand';
            if (is_chunked_upload_by_key && is_upload_command) {
                const upload_req_headers = args.request.headers;
                // NooBaa checks if the transfer is chunked by checking the content-encoding header
                // in this test file we artificially add aws-chunked to the content-encoding header
                // but we expect that the content is not chunked and the transfer-encoding header is not set
                // and the x-amz-decoded-content-length header is not set
                assert.ok(upload_req_headers['content-encoding'].includes('aws-chunked'));
                assert.ok(upload_req_headers['transfer-encoding'].includes('chunked'));
                assert.ok(upload_req_headers['x-amz-decoded-content-length'] !== undefined);
            }
            return next(args);
        },
        {
            step: 'finalizeRequest',
            name: 'logRequestHeaders',
            priority: 'high',
        }
    );
}

/**
 * get_object_buffer - Retrieve an object from S3 bucket and return its content as a Buffer along with its ETag
 * @param {S3Client} s3 
 * @param {String} bucket 
 * @param {String} key 
 * @returns {Promise<{body: Buffer, ETag: String}>} - The content of the object as a Buffer and its ETag
 */
async function get_object_buffer(s3, bucket, key) {
    const get_object_command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const get_object_response = await s3.send(get_object_command);
    dbg.log0('GetObject response:', _.omit(get_object_response, ['Body']));
    const body = await get_object_response.Body.transformToByteArray();
    return { body: Buffer.from(body), ETag: get_object_response.ETag };
}

/**
 * delete_object - Delete an object from S3 bucket
 * @param {S3Client} s3 
 * @param {String} bucket 
 * @param {String} key 
 * @returns {Promise<Void>} - Deletes the object from the S3 bucket
 */
async function delete_object(s3, bucket, key) {
    const delete_object_command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    const delete_object_response = await s3.send(delete_object_command);
    dbg.log0('Delete response:', delete_object_response);
}
