/* Copyright (C) 2026 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateRole.html
 */
async function create_role(req, res) {
    const params = {
        role_name: req.body.role_name,
        iam_path: req.body.path,
        assume_role_policy_document: req.body.assume_role_policy_document,
        description: req.body.description,
        max_session_duration: req.body.max_session_duration === undefined ?
            undefined : Number(req.body.max_session_duration),
    };
    dbg.log1('IAM CREATE ROLE', _.omit(params, 'assume_role_policy_document'));
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.CREATE_ROLE, params);
    params.assume_role_policy_document = JSON.parse(params.assume_role_policy_document);

    let reply;
    try {
        reply = await req.account_sdk.create_role(params);
        dbg.log2('create_role reply', _.omit(reply, 'assume_role_policy_document'));
    } catch (err) {
        dbg.error('create_role failed with params', _.omit(params, 'assume_role_policy_document'), 'error:', err);
        if (err.rpc_code === 'INVALID_SCHEMA' || err.rpc_code === 'INVALID_SCHEMA_PARAMS') {
            iam_utils.throw_malformed_policy_document_error();
        }
        throw err;
    }

    return {
        CreateRoleResponse: {
            CreateRoleResult: {
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
        }
    };
}

module.exports = {
    handler: create_role,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
