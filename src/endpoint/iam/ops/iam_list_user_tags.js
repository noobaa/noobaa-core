/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListUserTags.html
 */
async function list_user_tags(req, res) {

    const params = {
        username: req.body.user_name,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
    };

    dbg.log1('IAM LIST USER TAGS', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.LIST_USER_TAGS, params);
    const reply = await req.account_sdk.list_user_tags(params);
    dbg.log2('list_user_tags reply', reply);

    return {
        ListUserTagsResponse: {
            ListUserTagsResult: {
                Tags: reply.tags,
                IsTruncated: reply.is_truncated
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_user_tags,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
