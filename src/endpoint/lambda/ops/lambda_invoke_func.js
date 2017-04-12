/* Copyright (C) 2016 NooBaa */
'use strict';

function invoke_func(req, res) {
    return req.func_io.invoke({
            rpc_client: req.rpc_client,
            name: req.params.func_name,
            version: req.query.Qualifier || '$LATEST',
            event: req.body,
        })
        .then(func_res => {
            if (func_res.error) {
                res.setHeader('x-amz-function-error', 'Unhandled');
                return func_res.error;
            }
            return func_res.result;
        });
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
