/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListServiceSpecificCredentials.html
 */
async function list_service_specific_credentials(req, res) {

    const params = {
        service_name: req.body.service_name,
        username: req.body.user_name
    };
    if (params.username !== undefined) {
        dbg.log1('To check that we have the user we will run the IAM GET USER', params);
        iam_utils.validate_params(iam_constants.IAM_ACTIONS.GET_USER, params);
        await req.account_sdk.get_user({ username: params.username });
    }
    dbg.log1('IAM LIST SERVER SPECIFIC CREDENTIALS (returns empty list on every request)', params);

    return {
        ListServiceSpecificCredentialsResponse: {
            ListServiceSpecificCredentialsResult: {
                ServiceSpecificCredentials: [],
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_service_specific_credentials,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
