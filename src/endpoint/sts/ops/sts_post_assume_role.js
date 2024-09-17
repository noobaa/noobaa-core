/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
const { StsError } = require('../sts_errors');
const jwt_utils = require('../../../util/jwt_utils');
const config = require('../../../../config');
const { CONTENT_TYPE_APP_FORM_URLENCODED } = require('../../../util/http_utils');
const s3_utils = require('../../s3/s3_utils');

/**
 * https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html
 */
async function assume_role(req) {
    dbg.log1('sts_post_assume_role body: ', req.body);
    const duration_ms = _parse_sts_duration(req.body.duration_seconds);
    const duration_sec = Math.ceil(duration_ms / 1000);
    const expiration_time = Date.now() + duration_ms;
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
                    Expiration: s3_utils.format_s3_xml_date(expiration_time),
                    SessionToken: generate_session_token({
                        access_key: access_keys.access_key.unwrap(),
                        secret_key: access_keys.secret_key.unwrap(),
                        assumed_role_access_key: assumed_role.access_key
                    }, duration_sec)
                },
                PackedPolicySize: 0
            }
        }
    };
}

// create and return the signed token
/**
 * @param {Object} auth_options
 * @param {Number} expiry in seconds
 * @returns {String}
*/
function generate_session_token(auth_options, expiry) {
    dbg.log1('sts_post_assume_role.make_session_token: ', auth_options, expiry);
    return jwt_utils.make_auth_token(auth_options, { expiresIn: expiry });
}

// TODO: Generalize and move to a utils file in the future
/**
 * @param {String|undefined} duration_input duration in seconds
 * @returns {Number} duration in milliseconds
 */
function _parse_sts_duration(duration_input) {
    if (duration_input === undefined) {
        return config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;
    }

    const duration_sec = Number(duration_input);

    if (!Number.isInteger(duration_sec)) {
        throw new StsError(StsError.InvalidParameterValue);
    }

    if (duration_sec < config.STS_MIN_DURATION_SECONDS) {
        throw new StsError(_sts_duration_validation_error(duration_input, 'greater', config.STS_MIN_DURATION_SECONDS));
    }
    if (duration_sec > config.STS_MAX_DURATION_SECONDS) {
        throw new StsError(_sts_duration_validation_error(duration_input, 'less', config.STS_MAX_DURATION_SECONDS));
    }

    const duration_ms = duration_sec * 1000;
    return duration_ms;
}

function _sts_duration_validation_error(duration_input, constraint, constraint_value) {
    return {
        ...StsError.ValidationError,
        message: `Value ${duration_input} for durationSeconds failed to satisfy constraint: Member must have value ${constraint} than or equal to ${constraint_value}`,
    };
}

module.exports = {
    handler: assume_role,
    body: {
        type: CONTENT_TYPE_APP_FORM_URLENCODED,
    },
    reply: {
        type: 'xml',
    },
};
