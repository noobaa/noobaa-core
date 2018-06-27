/* Copyright (C) 2016 NooBaa */
'use strict';

const request = require('request');
const url = require('url');
const xml2js = require('xml2js');
const AWS = require('aws-sdk');
const _ = require('lodash');

const azure_storage = require('../../util/azure_storage_wrap');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const buffer_utils = require('../../util/buffer_utils');
const http_utils = require('../../util/http_utils');
const config = require('../../../config');
const { RPC_BUFFERS } = require('../../rpc');


class BlockStoreClient {

    static instance() {
        if (!BlockStoreClient._instance) {
            BlockStoreClient._instance = new BlockStoreClient();
        }
        return BlockStoreClient._instance;
    }

    write_block(rpc_client, params, options) {
        const { block_md } = params;
        switch (block_md.node_type) {
            case 'BLOCK_STORE_S3':
                return this._delegate_write_block_s3(rpc_client, params, options);
            case 'BLOCK_STORE_AZURE':
                return this._delegate_write_block_azure(rpc_client, params, options);
            default:
                return rpc_client.block_store.write_block(params, options);
        }
    }

    read_block(rpc_client, params, options) {
        const { block_md } = params;
        switch (block_md.node_type) {
            case 'BLOCK_STORE_S3':
                return this._delegate_read_block_s3(rpc_client, params, options);
            case 'BLOCK_STORE_AZURE':
                return this._delegate_read_block_azure(rpc_client, params, options);
            default:
                return rpc_client.block_store.read_block(params, options);
        }
    }

    _delegate_write_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;
        return rpc_client.block_store.delegate_write_block({ block_md, data_length: data.length }, options)
            .catch(err => {
                dbg.error('failed to get signed access information from cloud agent', err);
                // assuming that usage was not updated yet, so no need to update usage after error
                throw err;
            })
            .then(delegation_info => {
                const { host, container, block_key, blob_sas, metadata, usage, proxy } = delegation_info;
                // create a shared blob service using the blob_sas (shared access signature)
                const shared_blob_svc = azure_storage.createBlobServiceWithSas(host, blob_sas);
                shared_blob_svc.setProxy(proxy ? url.parse(proxy) : null);
                return P.fromCallback(callback => shared_blob_svc.createBlockBlobFromText(container,
                        block_key,
                        data, { metadata },
                        callback))
                    .catch(error => {
                        dbg.error('encountered error on _delegate_write_block_azure:', error);
                        return rpc_client.block_store.handle_delegator_error({ error, usage }, options);
                    });
            })
            .timeout(timeout);
    }


    _delegate_read_block_azure(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        const writable = buffer_utils.write_stream();
        // get signed access signature from the agent
        return rpc_client.block_store.delegate_read_block({ block_md: params.block_md }, options)
            .then(delegation_info => {
                if (delegation_info.cached_data) {
                    return delegation_info.cached_data;
                }
                const { host, container, block_key, blob_sas, proxy } = delegation_info;
                // use the signed access to read from azure
                const shared_blob_svc = azure_storage.createBlobServiceWithSas(host, blob_sas);
                shared_blob_svc.setProxy(proxy ? url.parse(proxy) : null);
                return P.fromCallback(callback => shared_blob_svc.getBlobToStream(container, block_key, writable, {
                            disableContentMD5Validation: true
                        },
                        callback))
                    .catch(error => {
                        dbg.error('encountered error on _delegate_read_block_azure:', error);
                        return rpc_client.block_store.handle_delegator_error({ error }, options);
                    })
                    .then(info => ({
                        [RPC_BUFFERS]: { data: buffer_utils.join(writable.buffers, writable.total_length) },
                        block_md: JSON.parse(Buffer.from(info.metadata.noobaablockmd || info.metadata.noobaa_block_md, 'base64'))
                    }));
            })
            .timeout(timeout);
    }

    _delegate_write_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_WRITE_BLOCK_TIMEOUT } = options;
        const { block_md } = params;
        const data = params[RPC_BUFFERS].data;

        return P.resolve()
            .then(async () => {

                const {
                    usage,
                    signed_url,
                    s3_params,
                    write_params,
                    proxy
                } = await rpc_client.block_store.delegate_write_block({ block_md, data_length: data.length }, options);

                try {
                    if (config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_SIGNED_URL && s3_params) {
                        if (!write_params) {
                            throw new Error('expected delegate_write_block to return write_params');
                        }
                        dbg.log1('got s3_params from block_store. writing using S3 sdk. s3_params =',
                            _.omit(s3_params, 'secretAccessKey'));
                        s3_params.httpOptions = { agent: http_utils.get_unsecured_http_agent(s3_params.endpoint, proxy) };
                        const s3 = new AWS.S3(s3_params);
                        write_params.Body = data;
                        await s3.putObject(write_params).promise();
                    } else {
                        const req_options = {
                            url: signed_url,
                            method: 'PUT',
                            followAllRedirects: true,
                            body: data
                        };
                        if (proxy) {
                            req_options.proxy = proxy;
                        }

                        const res = await P.fromCallback(callback => request(req_options, callback));

                        // if not OK parse the error and throw Error object
                        if (res.statusCode !== 200) {
                            return this._throw_s3_err(res);
                        }

                    }
                } catch (error) {
                    dbg.error('encountered error on _delegate_write_block_s3:', error);
                    return rpc_client.block_store.handle_delegator_error({ error, usage }, options);
                }

            })
            .timeout(timeout);
    }


    _delegate_read_block_s3(rpc_client, params, options) {
        const { timeout = config.IO_READ_BLOCK_TIMEOUT } = options;
        return P.resolve()
            .then(async () => {
                const delegation_info = await rpc_client.block_store.delegate_read_block({ block_md: params.block_md }, options);
                const {
                    cached_data,
                    s3_params,
                    read_params,
                    signed_url,
                    proxy
                } = delegation_info;

                if (cached_data) {
                    return {
                        block_md: cached_data.block_md,
                        [RPC_BUFFERS]: delegation_info[RPC_BUFFERS]
                    };
                }

                try {
                    if (config.EXPERIMENTAL_DISABLE_S3_COMPATIBLE_SIGNED_URL && s3_params) {
                        dbg.log1('got s3_params from block_store. reading using S3 sdk. s3_params =',
                            _.omit(s3_params, 'secretAccessKey'));

                        if (!read_params) {
                            throw new Error('expected delegate_read_block to return read_params');
                        }

                        s3_params.httpOptions = { agent: http_utils.get_unsecured_http_agent(s3_params.endpoint, proxy) };
                        const s3 = new AWS.S3(s3_params);

                        const data = await s3.getObject(read_params).promise();
                        const noobaablockmd = data.Metadata.noobaablockmd || data.Metadata.noobaa_block_md;
                        return {
                            [RPC_BUFFERS]: { data: data.Body },
                            block_md: JSON.parse(Buffer.from(noobaablockmd, 'base64'))
                        };
                    } else {
                        const req_options = {
                            url: signed_url,
                            method: 'GET',
                            encoding: null, // get a Buffer
                            followAllRedirects: true
                        };

                        if (proxy) {
                            req_options.proxy = proxy;
                        }

                        const [res, body] = await P.fromCallback(callback => request(req_options, callback), {
                            multiArgs: true
                        });

                        if (res.statusCode === 200) {
                            const noobaablockmd =
                                res.headers['x-amz-meta-noobaablockmd'] ||
                                res.headers['x-amz-meta-noobaa_block_md'];
                            const ret = {
                                [RPC_BUFFERS]: { data: body },
                                block_md: JSON.parse(Buffer.from(noobaablockmd, 'base64'))
                            };
                            return ret;

                        } else {
                            // parse the error and throw Error object
                            return this._throw_s3_err(res);
                        }
                    }

                } catch (error) {
                    dbg.error('encountered error on _delegate_read_block_s3:', error);
                    return rpc_client.block_store.handle_delegator_error({ error }, options);
                }
            })
            .timeout(timeout);

    }

    _throw_s3_err(res) {
        return P.fromCallback(callback => xml2js.parseString(res.body, callback))
            .then(xml_obj => {
                let err;
                if (!xml_obj.Error && !xml_obj.Error.Message && !xml_obj.Error.Code) {
                    // in case the structure is not as expected throw generic error
                    err = new Error(`Unkown error on _delegate_read_block_s3. statusCode=${res.statusCode} statusMessage=${res.statusMessage}`);
                } else {
                    err = new Error(xml_obj.Error.Message[0]);
                    err.code = xml_obj.Error.Code[0];
                }
                err.statusCode = res.statusCode;
                err.raw_error = res.body.toString();
                throw err;
            });
    }


}

exports.instance = BlockStoreClient.instance;
