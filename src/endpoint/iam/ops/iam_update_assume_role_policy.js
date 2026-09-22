/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_UpdateAssumeRolePolicy.html
 */
async function update_assume_role_policy(req, res) {
    const params = {
        role_name: req.body.role_name,
        policy_document: req.body.policy_document,
    };
    dbg.log1('IAM UPDATE ASSUME ROLE POLICY', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.UPDATE_ASSUME_ROLE_POLICY, params);
    params.policy_document = JSON.parse(params.policy_document);

    try {
        await req.account_sdk.update_assume_role_policy(params);
    } catch (err) {
        dbg.error('update_assume_role_policy failed with params', { role_name: params.role_name }, 'error:', err);
        if (err.rpc_code === 'INVALID_SCHEMA' || err.rpc_code === 'INVALID_SCHEMA_PARAMS') {
            iam_utils.throw_malformed_policy_document_error();
        }
        throw err;
    }

    return {
        UpdateAssumeRolePolicyResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: update_assume_role_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
