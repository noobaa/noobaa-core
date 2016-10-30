/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const crypto = require('crypto');
// const P = require('../util/promise');
const RpcError = require('../rpc/rpc_error');
const LambdaIO = require('../api/lambda_io');
const LambdaVM = require('../lambda/lambda_vm');
const LRUCache = require('../util/lru_cache');
const lambda_utils = require('../lambda/lambda_utils');

class ComputeNode {

    constructor({
        rpc_client
    }) {
        this.rpc_client = rpc_client;
        this.lambda_io = new LambdaIO();
        this.func_cache = new LRUCache({
            name: 'FuncCache',
            max_usage: 128 * 1024 * 1024,
            item_usage: (func, params) => func.config.code_size,
            validate: (func, params) => this._validate_func(func, params),
            make_key: params => params.name + '\0' + (params.version || '$LATEST'),
            load: params => this._load_func(params),
        });
    }

    invoke_func(req) {
        return this.func_cache.get_with_cache(_.pick(req.params, 'name', 'version'))
            .then(func => {
                if (req.params.code_size !== func.config.code_size ||
                    req.params.code_sha256 !== func.config.code_sha256) {
                    throw new RpcError('FUNC_CODE_MISMATCH',
                        `Function code does not match for ${func.name} version ${func.version} code_size ${func.config.code_size} code_sha256 ${func.config.code_sha256} requested code_size ${req.params.code_size} code_sha256 ${req.params.code_sha256}`);
                }
                const lambda_vm = new LambdaVM({
                    files: func._files,
                    handler: func.config.handler,
                    lambda_io: this.lambda_io,
                    rpc_client: this.rpc_client,
                });
                return lambda_vm.invoke(req.params.event);
            })
            .then(res => ({
                result: res
            }))
            .catch(err => ({
                error: _.pick(err, 'message', 'stack')
            }));
    }

    _validate_func(func, params) {
        return this.rpc_client.lambda.read_func(params)
            .then(res => {
                const validated = res.config.code_size === func.config.code_size &&
                    res.config.code_sha256 === func.config.code_sha256;
                if (!validated) {
                    console.log('_validate_func: invalidated', func, 'result', res);
                }
                return validated;
            });
    }

    _load_func(params) {
        let func;
        params.read_code = true;
        return this.rpc_client.lambda.read_func(params)
            .then(func_arg => {
                func = func_arg;
                console.log('_load_func: loaded', func);
            })
            .then(() => lambda_utils.unzip_in_memory(func.code.zipfile))
            .then(files => {
                console.log('_load_func: unzipped', files);
                func._files = files;
                return func;
            });
    }

}

module.exports = ComputeNode;
