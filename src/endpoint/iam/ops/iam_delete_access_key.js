/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_DeleteAccessKey.html
 */
async function delete_access_key(req, res) {

    const params = {
        username: req.body.user_name,
        access_key: req.body.access_key_id
    };
    dbg.log1('IAM DELETE ACCESS KEY', params);
    await req.account_sdk.delete_access_key(params);

    return {
        DeleteAccessKeyResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: delete_access_key,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
