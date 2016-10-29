/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const crypto = require('crypto');
// const P = require('../util/promise');
const LambdaIO = require('../api/lambda_io');
const LambdaVM = require('../lambda/lambda_vm');
// const lambda_utils = require('../lambda/lambda_utils');

class ComputeNode {

    constructor({
        rpc_client
    }) {
        this.rpc_client = rpc_client;
        this.cached_functions = new Map();
        this.lambda_io = new LambdaIO();
    }

    invoke_func(req) {
        return this._load_func(req)
            .then(func => {
                const lambda_vm = new LambdaVM({
                    files: func._files,
                    handler: func.handler,
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

    _load_func(req) {
        // TODO ComputeNode implement _load_func
        throw new Error('TODO ComputeNode implement _load_func');
        // const zip_buffer = new Buffer(fn.Code.ZipFile, 'base64');
        // fn.CodeSize = zip_buffer.length;
        // fn.CodeSha256 = crypto.createHash('sha256')
        //     .update(zip_buffer)
        //     .digest('base64');
        // console.log('_load_func_code:', fn);
        // return lambda_utils.unzip_in_memory(zip_buffer)
        //     .then(files => {
        //         fn._files = files;
        //     });
    }

}

module.exports = ComputeNode;
