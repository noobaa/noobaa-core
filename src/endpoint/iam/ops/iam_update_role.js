/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_UpdateRole.html
 */
async function update_role(req, res) {
    const params = {
        role_name: req.body.role_name,
        description: req.body.description,
        max_session_duration: req.body.max_session_duration === undefined ?
            undefined : Number(req.body.max_session_duration),
    };
    dbg.log1('IAM UPDATE ROLE', params);
    iam_utils.validate_params(iam_constants.IAM_ACTIONS.UPDATE_ROLE, params);
    await req.account_sdk.update_role(params);

    return {
        UpdateRoleResponse: {
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: update_role,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
