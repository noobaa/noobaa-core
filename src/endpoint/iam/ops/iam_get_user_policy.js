/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetUserPolicy.html
 */
async function get_user_policy(req, res) {

    const params = {
        username: req.body.user_name,
        policy_name: req.body.policy_name,
    };
    dbg.log1('IAM GET USER POLICY', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_USER_POLICY, params);
    const reply = await req.account_sdk.get_user_policy(params);
    dbg.log2('get_user_policy reply', reply);

    return {
        GetUserPolicyResponse: {
            GetUserPolicyResult: {
                UserName: reply.username,
                PolicyName: reply.policy_name,
                PolicyDocument: reply.policy_document,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: get_user_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
