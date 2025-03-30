/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListPolicies.html
 */
async function list_policies(req, res) {

    const params = {
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
        iam_path_prefix: req.body.path_prefix,
        only_attached: req.body.only_attached,
        policy_usage_filter: req.body.policy_usage_filter,
        scope: req.body.scope,
    };
    dbg.log1('IAM LIST POLICIES (returns empty list on every request)', params);

    return {
        ListPoliciesResponse: {
            ListPoliciesResult: {
                Policies: [],
                IsTruncated: false,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_policies,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
