/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const { StsError } = require('./sts_errors');
const jwt_utils = require('../../util/jwt_utils');
const config = require('../../../config');

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
function parse_sts_duration(duration_input) {
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

exports.generate_session_token = generate_session_token;
exports.parse_sts_duration = parse_sts_duration;
