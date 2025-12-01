/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetUser.html
 */
async function get_user(req, res) {

    const params = {
        username: req.body.user_name,
    };
    dbg.log1('IAM GET USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_USER, params);
    const reply = await req.account_sdk.get_user(params);
    dbg.log2('get_user reply', reply);

    return {
        GetUserResponse: {
            GetUserResult: {
                User: {
                    UserId: reply.user_id,
                    Path: reply.iam_path || iam_constants.IAM_DEFAULT_PATH,
                    UserName: reply.username,
                    Arn: reply.arn,
                    CreateDate: iam_utils.format_iam_xml_date(reply.create_date),
                    PasswordLastUsed: iam_utils.format_iam_xml_date(reply.password_last_used),
                    Tags: reply.tags && reply.tags.length === 0 ? undefined : reply.tags
                }
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: get_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
