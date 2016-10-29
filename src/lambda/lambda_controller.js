/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const crypto = require('crypto');

const P = require('../util/promise');
const LambdaIO = require('../api/lambda_io');
const LambdaVM = require('./lambda_vm');
const lambda_utils = require('./lambda_utils');

const STORED_FUNC_FIELDS = [
    'FunctionName',
    'Runtime',
    'Handler',
    'Role',
    'MemorySize',
    'Timeout',
    'Description',
    // reply
    'CodeSize',
    'CodeSha256',
    'Version',
    'LastModified',
    'FunctionArn',
];

class LambdaController {

    constructor(rpc) {
        this.rpc = rpc;
        let signal_client = this.rpc.new_client();
        let n2n_agent = this.rpc.register_n2n_agent(signal_client.node.n2n_signal);
        n2n_agent.set_any_rpc_address();
    }

    prepare_request(req) {
        req.rpc_client = this.rpc.new_client();
        req.rpc_client.options.auth_token = {
            access_key: req.access_key,
            string_to_sign: req.string_to_sign,
            signature: req.signature,
            extra: req.noobaa_v4
        };
    }

    create_func(req, res) {
        console.log('create_function', req.params, req.body);
        const fn = req.body;

        return req.rpc_client.lambda.create_func({
                config: _.omitBy({
                    name: fn.FunctionName,
                    description: fn.Description,
                    role: fn.Role,
                    runtime: fn.Runtime,
                    handler: fn.Handler,
                    memory_size: fn.MemorySize,
                    timeout: fn.Timeout,
                }, _.isUndefined),
                code: _.omitBy({
                    zipfile: fn.Code.ZipFile,
                    s3_bucket: fn.Code.S3Bucket,
                    s3_key: fn.Code.S3Key,
                    s3_obj_version: fn.Code.S3ObjectVersion,
                }, _.isUndefined),
                publish: fn.Publish,
            })
            .then(info => this._get_func_info(info));
    }

    invoke_func(req, res) {
        const name = req.params.func_name;
        const event = req.body;
        console.log('invoke', name, event);
        return req.rpc_client.lambda.invoke_func({
                name: req.params,
                event: event,
            })
            .then(res => {
                // if (res.error)
            });
    }

    list_funcs(req, res) {
        console.log('list_functions', req.params, req.body);
        return req.rpc_client.lambda.list_funcs()
            .then(res => ({
                Functions: _.map(res.functions, _get_func_info)
            }));
    }

    _get_func_info(fn) {
        return _.pick(fn, STORED_FUNC_FIELDS);
    }

}

module.exports = LambdaController;
