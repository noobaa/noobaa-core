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

    const tags = [];
    let tag_index = 1;
    while (req.body[`tags_member_${tag_index}_key`]) {
        tags.push({
            key: req.body[`tags_member_${tag_index}_key`],
            value: req.body[`tags_member_${tag_index}_value`] || ''
        });
        tag_index += 1;
    }
    const params = {
        username: req.body.user_name,
        tags: tags,
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
