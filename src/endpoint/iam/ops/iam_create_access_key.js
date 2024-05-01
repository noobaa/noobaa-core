/* Copyright (C) 2024 NooBaa */
'use strict';
const _ = require('lodash');
const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_CreateAccessKey.html
 */
async function create_access_key(req, res) {

    const params = {
        username: req.body.user_name,
    };
    dbg.log1('IAM CREATE ACCESS KEY', params);
    const reply = await req.account_sdk.create_access_key(params);
    dbg.log2('create_access_key reply (omit secrets key id)', _.omit(reply, 'secret_key'));

    return {
        CreateAccessKeyResponse: {
            CreateAccessKeyResult: {
                AccessKey: {
                    UserName: reply.username,
                    AccessKeyId: reply.access_key,
                    Status: reply.status,
                    SecretAccessKey: reply.secret_key,
                    // CreateDate appears in actual respond (not in docs)
                    CreateDate: iam_utils.format_iam_xml_date(reply.create_date),
                }
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        }
    };
}

module.exports = {
    handler: create_access_key,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
