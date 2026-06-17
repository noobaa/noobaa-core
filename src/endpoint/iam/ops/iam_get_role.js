/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetRole.html
 */
async function get_role(req, res) {
    const params = {
        role_name: req.body.role_name,
    };
    dbg.log1('IAM GET ROLE', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_ROLE, params);
    const reply = await req.account_sdk.get_role(params);
    dbg.log2('get_role reply', reply);

    return {
        GetRoleResponse: {
            GetRoleResult: {
                Role: {
                    Path: reply.iam_path || iam_constants.IAM_DEFAULT_PATH,
                    RoleName: reply.role_name,
                    RoleId: reply.role_id,
                    Arn: reply.arn,
                    CreateDate: iam_utils.format_iam_xml_date(reply.create_date),
                    AssumeRolePolicyDocument: JSON.stringify(reply.assume_role_policy_document),
                    Description: reply.description,
                    MaxSessionDuration: reply.max_session_duration ?? iam_constants.DEFAULT_MAX_SESSION_DURATION_SECS,
                }
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: get_role,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
