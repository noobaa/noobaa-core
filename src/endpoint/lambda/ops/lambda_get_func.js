/* Copyright (C) 2016 NooBaa */
'use strict';

const lambda_utils = require('../lambda_utils');

function get_func(req, res) {
    console.log('read_func', req.params, req.query);
    return req.rpc_client.func.read_func({
            name: req.params.func_name,
            version: req.query.Qualifier || '$LATEST'
        })
        .then(func => ({
            Configuration: lambda_utils.get_func_config(func),
            Code: {
                Location: func.code_location.url,
                RepositoryType: func.code_location.repository,
            }
        }));
}

module.exports = {
    handler: get_func,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'json',
    },
};
