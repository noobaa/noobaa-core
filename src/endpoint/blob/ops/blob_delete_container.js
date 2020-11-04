/* Copyright (C) 2016 NooBaa */
'use strict';

async function delete_container(req, res) {
    await req.object_sdk.delete_bucket({ name: req.params.bucket });
    res.statusCode = 202;
}

module.exports = {
    handler: delete_container,
    body: {
        type: 'empty',
    },
    reply: {
        type: 'empty',
    },
};
