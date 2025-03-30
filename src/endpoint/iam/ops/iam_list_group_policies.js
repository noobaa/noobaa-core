/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListGroupPolicies.html
 */
async function list_groups_policies(req, res) {

    const params = {
        group_name: req.body.group_name,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
    };

    dbg.log1('IAM LIST GROUP POLICIES (returns empty list on every request)', params);

    return {
        ListGroupPoliciesResponse: {
            ListGroupPoliciesResult: {
                PolicyNames: [],
                IsTruncated: false,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_groups_policies,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
