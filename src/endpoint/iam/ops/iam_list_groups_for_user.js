/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListGroupsForUser.html
 */
async function list_groups_for_user(req, res) {

    const params = {
        username: req.body.user_name,
    };

    dbg.log1('To check that we have the user we will run the IAM GET USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_USER, params);
    await req.account_sdk.get_user({ username: params.username });

    dbg.log1('IAM LIST GROUPS FOR USER (returns empty list on every request)', params);

    return {
        ListGroupsForUserResponse: {
            ListGroupsForUserResult: {
                Groups: [],
                IsTruncated: false,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_groups_for_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
