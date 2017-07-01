/* Copyright (C) 2016 NooBaa */
'use strict';

function delete_func(req, res) {
    return req.func_sdk.delete_func({
        name: req.params.func_name,
        version: req.query.Qualifier || '$LATEST'
    });
}

module.exports = {
    handler: delete_func,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
