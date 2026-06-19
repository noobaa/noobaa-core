/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListRoles.html
 */
async function list_roles(req, res) {
    const params = {
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
        iam_path_prefix: req.body.path_prefix,
    };
    dbg.log1('IAM LIST ROLES', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.LIST_ROLES, params);
    const reply = await req.account_sdk.list_roles(params);
    dbg.log2('list_roles reply', reply);

    return {
        ListRolesResponse: {
            ListRolesResult: {
                Roles: reply.members.map(member => ({
                    member: {
                        Path: member.iam_path || iam_constants.IAM_DEFAULT_PATH,
                        RoleName: member.role_name,
                        RoleId: member.role_id,
                        Arn: member.arn,
                        CreateDate: iam_utils.format_iam_xml_date(member.create_date),
                        AssumeRolePolicyDocument: JSON.stringify(member.assume_role_policy_document),
                        Description: member.description === undefined ? undefined : member.description,
                        MaxSessionDuration: member.max_session_duration ?? iam_constants.DEFAULT_MAX_SESSION_DURATION_SECS,
                    },
                })),
                IsTruncated: reply.is_truncated,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_roles,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
