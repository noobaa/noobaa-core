/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { StsError } = require('../sts_errors');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const s3_utils = require('../../s3/s3_utils');
const sts_utils = require('../../sts/sts_utils');
const _ = require('lodash');

/**
 * https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html
 */
async function assume_role_with_web_identity(req) {
    dbg.log0('sts_post_assume_role_with_web_identity body: ', _.omit(req.body, 'web_identity_token'));
    const duration_ms = sts_utils.parse_sts_duration(req.body.duration_seconds);
    const duration_sec = Math.ceil(duration_ms / 1000);
    const expiration_time = Date.now() + duration_ms;
    let assumed_role;
    try {
        assumed_role = await req.sts_sdk.get_assumed_ldap_user(req);
    } catch (err) {
        if (err.rpc_code === 'ACCESS_DENIED') {
            throw new StsError(StsError.AccessDeniedException);
        }
        if (err.rpc_code === 'EXPIRED_WEB_IDENTITY_TOKEN') {
            throw new StsError(StsError.ExpiredToken);
        }
        if (err.rpc_code === 'INVALID_WEB_IDENTITY_TOKEN') {
            throw new StsError({ ...StsError.InvalidIdentityToken, message: err.message });
        }
        dbg.error('get_assumed_ldap_user error:', err);
        throw new StsError(StsError.InternalFailure);
    }
    // Temporary credentials are NOT stored in noobaa
    // The generated session token will store in it the temporary credentials and expiry and the role's access key
    const access_keys = await req.sts_sdk.generate_temp_access_keys();

    return {
        AssumeRoleWithWebIdentityResponse: {
            AssumeRoleWithWebIdentityResult: {
                SubjectFromWebIdentityToken: assumed_role.sub,
                Audience: assumed_role.aud,
                AssumedRoleUser: {
                    Arn: `arn:aws:sts::${assumed_role.access_key}:assumed-role/${assumed_role.role_config.role_name}/${req.body.role_session_name}`,
                    AssumedRoleId: `${assumed_role.access_key}:${req.body.role_session_name}`
                },
                Credentials: {
                    AccessKeyId: access_keys.access_key.unwrap(),
                    SecretAccessKey: access_keys.secret_key.unwrap(),
                    Expiration: s3_utils.format_s3_xml_date(expiration_time),
                    SessionToken: sts_utils.generate_session_token({
                        access_key: access_keys.access_key.unwrap(),
                        secret_key: access_keys.secret_key.unwrap(),
                        assumed_role_access_key: assumed_role.access_key
                    }, duration_sec)
                },
                SourceIdentity: assumed_role.dn,
                Provider: assumed_role.iss,
            }
        }
    };
}

module.exports = {
    handler: assume_role_with_web_identity,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
