/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const vm = require('vm');
const crypto = require('crypto');

const P = require('../util/promise');
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

    constructor() {
        this.functions_by_name = new Map();
    }

    create_function(req, res) {
        console.log('create_function', req.params, req.body);
        const fn = req.body;
        fn.Version = '$LATEST';
        fn.LastModified = '2016-07-18T22:05:21.682+0000';
        fn.FunctionArn = 'arn:aws:lambda:us-east-1:638243541865:function:guy1';
        this.functions_by_name.set(fn.FunctionName, fn);

        return P.resolve()
            .then(() => this._load_func_code(fn))
            .then(() => this._get_func_info(fn));
    }

    invoke(req, res) {
        console.log('invoke', req.params);
        const fn = this.functions_by_name.get(req.params.func_name);
        if (!fn) throw new Error('NoSuchFunction');
        const handler_split = fn.Handler.split('.');
        const module_name = handler_split[0];
        const export_name = handler_split[1];
        return lambda_utils.safe_invoke(fn._scripts, module_name, export_name);
    }

    list_functions(req, res) {
        console.log('list_functions', req.params, req.body);
        const funcs = [];
        for (const fn of this.functions_by_name.values()) {
            funcs.push(this._get_func_info(fn));
        }
        return {
            Functions: funcs
        };
    }

    _get_func_info(fn) {
        return _.pick(fn, STORED_FUNC_FIELDS);
    }

    _load_func_code(fn) {
        const zip_buffer = new Buffer(fn.Code.ZipFile, 'base64');
        fn.CodeSize = zip_buffer.length;
        fn.CodeSha256 = crypto.createHash('sha256')
            .update(zip_buffer)
            .digest('base64');
        console.log('_load_func_code:', fn);
        return lambda_utils.unzip_in_memory(zip_buffer)
            .then(files => {
                fn._scripts = _.mapValues(files, f => new vm.Script(f));
            });
    }

}

module.exports = LambdaController;
