/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const iam_constants = require('../iam_constants');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const IamError = require('../iam_errors').IamError;

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListServerCertificateTags.html
 */
async function list_server_certificate_tags(req, res) {

    const params = {
        server_certificate_name: req.body.server_certificate_name,
        marker: req.body.marker,
        max_items: iam_utils.parse_max_items(req.body.max_items) ?? iam_constants.DEFAULT_MAX_ITEMS,
    };
    dbg.log1('IAM LIST SERVER CERTIFICATE TAGS (returns NoSuchEntity on every request)', params);
    const message_with_details = `The Server Certificate with name ${params.server_certificate_name} cannot be found`;
    const { code, http_code, type } = IamError.NoSuchEntity;
    throw new IamError({ code, message: message_with_details, http_code, type });
}

module.exports = {
    handler: list_server_certificate_tags,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
