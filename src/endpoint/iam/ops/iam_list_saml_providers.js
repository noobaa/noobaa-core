/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');

/**
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_ListSAMLProviders.html
 */
async function list_saml_providers(req, res) {
    dbg.log1('IAM LIST ROLES (returns empty list on every request)');

    return {
        ListSAMLProvidersResponse: {
            ListSAMLProvidersResult: {
                SAMLProviderList: [],
            },
            ResponseMetadata: {
                RequestId: req.request_id,
            }
        },
    };
}

module.exports = {
    handler: list_saml_providers,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
