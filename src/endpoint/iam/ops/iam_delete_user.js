/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_DeleteUser.html
 */
async function delete_user(req, res) {


    const params = {
        username: req.body.user_name,
    };
    dbg.log1('IAM DELETE USER', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.DELETE_USER, params);
    await req.account_sdk.delete_user(params);

    return {
        DeleteUserResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: delete_user,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
