/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

const IamError = require('../iam_errors').IamError;

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListEntitiesForPolicy.html
 */
async function list_entities_for_policy(req, res) {

    const params = {
        policy_arn: req.body.policy_arn,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
        iam_path_prefix: req.body.path_prefix,
        entity_filter: req.body.entity_filter,
        policy_filter_usage: req.body.policy_filter_usage,
    };
    dbg.log1('IAM LIST ENTITIES FOR POLICY (returns NoSuchEntity on every request)', params);
    const message_with_details = ` Policy ${params.policy_arn} does not exist or is not attachable`;
    const { code, http_code, type } = IamError.NoSuchEntity;
    throw new IamError({ code, message: message_with_details, http_code, type });
}

module.exports = {
    handler: list_entities_for_policy,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
