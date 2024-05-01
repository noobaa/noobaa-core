/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_UpdateUser.html
 */
async function update_user(req, res) {

    const params = {
        username: req.body.user_name,
        new_username: req.body.new_user_name,
        new_path: req.body.new_path,
    };
    dbg.log1('IAM UPDATE USER', params);
    const reply = await req.account_sdk.update_user(params);
    dbg.log2('update_user reply', reply);

    return {
        UpdateUserResponse: {
            UpdateUserResult: {
                User: {
                    Path: reply.path || iam_utils.AWS_DEFAULT_PATH,
                    UserName: reply.username,
                    UserId: reply.user_id,
                    Arn: reply.arn,
                }
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: update_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
