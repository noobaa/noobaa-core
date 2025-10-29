/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_UntagUser.html
 */
async function untag_user(req, res) {

    // parse tag keys from AWS encoded format
    // input: { tag_keys_member_1: 'env', tag_keys_member_2: 'team', ... }
    // output: ['env', 'team', ...]
    const params = {
        username: req.body.user_name,
        tag_keys: iam_utils.parse_tag_keys_from_request_body(req.body),
    };

    dbg.log1('IAM UNTAG USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.UNTAG_USER, params);
    await req.account_sdk.untag_user(params);

    return {
        UntagUserResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: untag_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
