/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const iam_utils = require('../iam_utils');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListUsers.html
 */
async function list_users(req, res) {

    const params = {
        marker: req.body.marker,
        max_items: req.body.max_items,
        path_prefix: req.body.path_prefix,
    };
    dbg.log1('IAM LIST USERS', params);
    const reply = await req.account_sdk.list_users(params);
    dbg.log2('list_users reply', reply);

    return {
        ListUsersResponse: {
            ListUsersResult: {
                Users: reply.members.map(member => ({
                    member: {
                        UserId: member.user_id,
                        Path: member.path || iam_utils.AWS_DEFAULT_PATH,
                        UserName: member.username,
                        Arn: member.arn,
                        CreateDate: iam_utils.format_iam_xml_date(member.create_date),
                        PasswordLastUsed: iam_utils.format_iam_xml_date(member.password_last_used),
                    },
                })),
                IsTruncated: reply.is_truncated,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_users,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
