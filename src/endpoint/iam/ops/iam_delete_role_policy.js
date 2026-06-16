/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_DeleteRolePolicy.html
 */
async function delete_role_policy(req, res) {
    const params = {
        role_name: req.body.role_name,
        policy_name: req.body.policy_name,
    };
    dbg.log1('IAM DELETE ROLE POLICY', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.DELETE_ROLE_POLICY, params);
    await req.account_sdk.delete_role_policy(params);

    return {
        DeleteRolePolicyResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: delete_role_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
