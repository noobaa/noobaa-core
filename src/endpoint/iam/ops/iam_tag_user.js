/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_TagUser.html
 */
async function tag_user(req, res) {

    // parse tags from AWS encoded format
    // input: { tags_member_1_key: 'env', tags_member_1_value: 'prod', ... }
    // output: [{ key: 'env', value: 'prod' }, ...]
    const params = {
        username: req.body.user_name,
        tags: iam_utils.parse_tags_from_request_body(req.body),
    };

    dbg.log1('IAM TAG USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.TAG_USER, params);
    await req.account_sdk.tag_user(params);

    return {
        TagUserResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: tag_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
