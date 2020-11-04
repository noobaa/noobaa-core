/* Copyright (C) 2016 NooBaa */
'use strict';

async function invoke_func(req, res) {
    const func_res = await req.func_sdk.invoke_func({
        name: req.params.func_name,
        version: req.query.Qualifier || '$LATEST',
        event: req.body,
    });
    if (func_res.error) {
        res.setHeader('x-amz-function-error', 'Unhandled');
        return func_res.error;
    }
    return func_res.result;
}

module.exports = {
    handler: invoke_func,
    body: {
        type: 'json',
    },
    reply: {
        type: 'json',
    },
};
