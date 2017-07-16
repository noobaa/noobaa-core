/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

const lambda_utils = require('../lambda_utils');

function create_func(req, res) {
    const fn = req.body;
    console.log('create_func', req.params, fn);
    return req.func_sdk.create_func({
            config: _.omitBy({
                name: fn.FunctionName,
                version: '$LATEST',
                description: fn.Description,
                role: fn.Role,
                runtime: fn.Runtime,
                handler: fn.Handler,
                memory_size: fn.MemorySize,
                timeout: fn.Timeout,
                pools: fn.VpcConfig && fn.VpcConfig.SubnetIds,
            }, _.isUndefined),
            code: _.omitBy({
                zipfile: Buffer.from(fn.Code.ZipFile, 'base64'),
                s3_bucket: fn.Code.S3Bucket,
                s3_key: fn.Code.S3Key,
                s3_obj_version: fn.Code.S3ObjectVersion,
            }, _.isUndefined),
            publish: fn.Publish,
        })
        .then(func => lambda_utils.get_func_config(func));
}

module.exports = {
    handler: create_func,
    body: {
        type: 'json',
    },
    reply: {
        type: 'json',
    },
};
