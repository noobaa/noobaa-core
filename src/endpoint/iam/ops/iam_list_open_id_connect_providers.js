/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListOpenIDConnectProviders.html
 */
async function list_open_id_connect_providers(req, res) {
    dbg.log1('IAM LIST OPEN ID CONNECT PROVIDERS (returns empty list on every request)');

    return {
        ListOpenIDConnectProvidersResponse: {
            ListOpenIDConnectProvidersResult: {
                OpenIDConnectProviderList: [],
                IsTruncated: false,
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_open_id_connect_providers,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
