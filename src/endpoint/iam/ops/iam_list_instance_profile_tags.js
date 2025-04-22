/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const IamError = require('../iam_errors').IamError;

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListInstanceProfileTags.html
 */
async function list_instance_profile_tags(req, res) {

    const params = {
        instance_profile: req.body.instance_profile_name,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
    };
    dbg.log1('IAM LIST INSTANCE PROFILE TAGS (returns NoSuchEntity on every request)', params);
    const message_with_details = `Instance Profile ${params.instance_profile} cannot be found`;
    const { code, http_code, type } = IamError.NoSuchEntity;
    throw new IamError({ code, message: message_with_details, http_code, type });
}

module.exports = {
    handler: list_instance_profile_tags,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
