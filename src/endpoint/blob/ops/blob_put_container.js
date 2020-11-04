/* Copyright (C) 2016 NooBaa */
'use strict';

async function put_container(req, res) {
    await req.object_sdk.create_bucket({ name: req.params.bucket });
    res.statusCode = 201;
}

module.exports = {
    handler: put_container,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
