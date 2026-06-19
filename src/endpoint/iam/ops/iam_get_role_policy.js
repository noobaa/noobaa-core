/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetRolePolicy.html
 */
async function get_role_policy(req, res) {
    const params = {
        role_name: req.body.role_name,
        policy_name: req.body.policy_name,
    };
    dbg.log1('IAM GET ROLE POLICY', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_ROLE_POLICY, params);
    const reply = await req.account_sdk.get_role_policy(params);
    dbg.log2('get_role_policy reply', reply);

    return {
        GetRolePolicyResponse: {
            GetRolePolicyResult: {
                RoleName: reply.role_name,
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
    handler: get_role_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
