/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const crypto = require('crypto');

// const P = require('../util/promise');
// const LambdaIO = require('../api/lambda_io');

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

    create_func(req) {
        const fn = req.body;
        console.log('create_func', req.params, fn);
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
                    zipfile: new Buffer(fn.Code.ZipFile, 'base64'),
                    s3_bucket: fn.Code.S3Bucket,
                    s3_key: fn.Code.S3Key,
                    s3_obj_version: fn.Code.S3ObjectVersion,
                }, _.isUndefined),
                publish: fn.Publish,
            })
            .then(func => this._get_func_config(func));
    }

    read_func(req) {
        console.log('read_func', req.params, req.query);
        return req.rpc_client.lambda.read_func({
                name: req.params.func_name,
                version: req.query.Qualifier
            })
            .then(func => ({
                Configuration: this._get_func_config(func),
                Code: {
                    Location: func.code_location.url,
                    RepositoryType: func.code_location.repository,
                }
            }));
    }

    delete_func(req) {
        return req.rpc_client.lambda.delete_func({
            name: req.params.func_name,
            version: req.query.Qualifier
        }).return();
    }

    list_funcs(req) {
        console.log('list_funcs', req.params, req.query);
        return req.rpc_client.lambda.list_funcs()
            .then(res => ({
                Functions: _.map(res.functions, func => this._get_func_config(func))
            }));
    }

    invoke_func(req, res) {
        const name = req.params.func_name;
        const event = req.body;
        console.log('invoke_func', name, event);
        return req.rpc_client.lambda.invoke_func({
                name: req.params.func_name,
                event: event,
            })
            .then(func_res => {
                if (func_res.error) {
                    res.setHeader('x-amz-function-error', 'Unhandled');
                    return func_res.error;
                }
                return func_res.result;
            });
    }

    _get_func_config(info) {
        return {
            FunctionName: info.config.name,
            Version: info.config.version || '$LATEST',
            Runtime: info.config.runtime,
            Handler: info.config.handler,
            Role: info.config.role,
            MemorySize: info.config.memory_size,
            Timeout: info.config.timeout,
            Description: info.config.description,
            CodeSize: info.config.code_size,
            CodeSha256: info.config.code_sha256,
            LastModified: new Date(info.config.last_modified).toISOString(),
            FunctionArn: info.config.resource_name,
        };
    }

}

module.exports = LambdaController;
