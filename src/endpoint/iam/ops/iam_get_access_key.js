/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_GetAccessKeyLastUsed.html
 */
async function get_access_key_last_used(req, res) {


    const params = {
        access_key: req.body.access_key_id,
    };
    dbg.log1('IAM GET ACCESS KEY LAST USED', params);
    const reply = await req.account_sdk.get_access_key_last_used(params);
    dbg.log2('get_access_key_last_used reply', reply);

    return {
        GetAccessKeyLastUsedResponse: {
            GetAccessKeyLastUsedResult: {
                AccessKeyLastUsed: {
                    Region: reply.region,
                    LastUsedDate: iam_utils.format_iam_xml_date(reply.last_used_date),
                    ServiceName: reply.service_name,
                },
                UserName: reply.username,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: get_access_key_last_used,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
