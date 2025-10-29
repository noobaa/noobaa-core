/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const IamError = require('../iam_errors').IamError;

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_PutUserPolicy.html
 */
async function put_user_policy(req, res) {

    const params = {
        username: req.body.user_name,
        policy_name: req.body.policy_name,
        policy_document: req.body.policy_document,
    };
    dbg.log1('IAM PUT USER POLICY', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.PUT_USER_POLICY, params);
    params.policy_document = JSON.parse(params.policy_document); // we want this property as JSON for easier handling
    try {
        const reply = await req.account_sdk.put_user_policy(params);
        dbg.log2('put_user_policy reply', reply);
    } catch (err) {
        dbg.error(`put_user_policy failed with params`, params, 'error:', err);
        if (err.rpc_code === "INVALID_SCHEMA" || err.rpc_code === "INVALID_SCHEMA_PARAMS") {
            const message_with_details = `Syntax errors in policy`;
            const { code, http_code, type } = IamError.MalformedPolicyDocument;
            throw new IamError({ code, message: message_with_details, http_code, type });
        }
        throw err;
    }


    return {
        PutUserPolicyResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: put_user_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
