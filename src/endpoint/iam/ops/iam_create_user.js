/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateUser.html
 */
async function create_user(req, res) {

    const params = {
        iam_path: req.body.path,
        username: req.body.user_name,
    };
    dbg.log1('IAM CREATE USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.CREATE_USER, params);
    const reply = await req.account_sdk.create_user(params);
    dbg.log2('create_user reply', reply);

    return {
        CreateUserResponse: {
            CreateUserResult: {
                User: {
                    Path: reply.iam_path || iam_utils.IAM_DEFAULT_PATH,
                    UserName: reply.username,
                    UserId: reply.user_id,
                    Arn: reply.arn,
                    // CreateDate appears in actual respond (not in docs)
                    CreateDate: iam_utils.format_iam_xml_date(reply.create_date),
                }
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: create_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
