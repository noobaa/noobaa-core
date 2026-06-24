/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListRolePolicies.html
 */
async function list_role_policies(req, res) {
    const params = {
        role_name: req.body.role_name,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
    };
    dbg.log1('IAM LIST ROLE POLICIES', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.LIST_ROLE_POLICIES, params);
    const reply = await req.account_sdk.list_role_policies(params);
    dbg.log2('list_role_policies reply', reply);

    return {
        ListRolePoliciesResponse: {
            ListRolePoliciesResult: {
                PolicyNames: reply.members.map(member => ({
                    member,
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
    handler: list_role_policies,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
