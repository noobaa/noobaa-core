/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const lambda_utils = require('../lambda_utils');

async function list_funcs(req, res) {
    const reply = await req.func_sdk.list_funcs();
    return {
        Functions: _.map(reply.functions, func => lambda_utils.get_func_config(func))
    };
}

module.exports = {
    handler: list_funcs,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'json',
    },
};
