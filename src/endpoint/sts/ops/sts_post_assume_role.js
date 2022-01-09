/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { StsError } = require('../sts_errors');
const jwt_utils = require('../../../util/jwt_utils');
const config = require('../../../../config');

/**
 * https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
 */
async function assume_role(req) {
    dbg.log1('sts_post_assume_role body: ', req.body);
    let assumed_role;
    try {
        assumed_role = await req.sts_sdk.get_assumed_role(req);
    } catch (err) {
        if (err.code === 'ACCESS_DENIED') {
            throw new StsError(StsError.AccessDeniedException);
        }
        throw new StsError(StsError.InternalFailure);
    }
    // Temporary credentials are NOT stored in noobaa
    // The generated session token will store in it the temporary credentials and expiry and the role's access key
    const access_keys = await req.sts_sdk.generate_temp_access_keys();
    const expiry = config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;
    return {
        AssumeRoleResponse: {
            AssumeRoleResult: {
                AssumedRoleUser: {
                    Arn: `arn:aws:sts::${assumed_role.access_key}:assumed-role/${assumed_role.role_config.role_name}/${req.body.role_session_name}`,
                    AssumedRoleId: `${assumed_role.access_key}:${req.body.role_session_name}`
                },
                Credentials: {
                    AccessKeyId: access_keys.access_key.unwrap(),
                    SecretAccessKey: access_keys.secret_key.unwrap(),
                    Expiration: expiry,
                    SessionToken: generate_session_token({
                        access_key: access_keys.access_key.unwrap(),
                        secret_key: access_keys.secret_key.unwrap(),
                        assumed_role_access_key: assumed_role.access_key
                    }, expiry)
                },
                PackedPolicySize: 0
            }
        }
    };
}

// create and return the signed token
function generate_session_token(auth_options, expiry) {
    dbg.log1('sts_post_assume_role.make_session_token: ', auth_options, expiry);
    return jwt_utils.make_auth_token(auth_options, { expiresIn: expiry });
}

module.exports = {
    handler: assume_role,
    body: {
        type: 'application/x-www-form-urlencoded',
    },
    reply: {
        type: 'xml',
    },
};
