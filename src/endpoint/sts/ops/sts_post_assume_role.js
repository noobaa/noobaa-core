/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { StsError } = require('../sts_errors');

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
    // TODO: need to generate session token and store in it 
    // the temporary credentials and expiry
    const access_keys = await req.sts_sdk.generate_temp_access_keys();
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
                    Expiration: '',
                    SessionToken: ''
                },
                PackedPolicySize: 0
            }
        }
    };
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
