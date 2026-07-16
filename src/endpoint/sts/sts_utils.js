/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const { StsError } = require('./sts_errors');
const jwt_utils = require('../../util/jwt_utils');
const config = require('../../../config');

/**
 * generate_session_token creates and returns the signed session token
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
 * parse_sts_duration parses and validates STS durationSeconds against role max session duration
 * @param {String|undefined} duration_input duration in seconds
 * @param {Number} [role_max_session_duration] role MaxSessionDuration in seconds
 * @returns {Number} duration in milliseconds
 */
function parse_sts_duration(duration_input, role_max_session_duration) {
    const max_duration = role_max_session_duration === undefined ?
        config.STS_MAX_DURATION_SECONDS :
        Math.min(config.STS_MAX_DURATION_SECONDS, role_max_session_duration);

    if (duration_input === undefined) {
        const default_ms = config.STS_DEFAULT_SESSION_TOKEN_EXPIRY_MS;
        if (default_ms > max_duration * 1000) {
            throw new StsError(_sts_duration_validation_error(
                String(default_ms / 1000), 'less', max_duration));
        }
        return default_ms;
    }

    const duration_sec = Number(duration_input);
    if (!Number.isInteger(duration_sec)) {
        throw new StsError(StsError.InvalidParameterValue);
    }
    if (duration_sec < config.STS_MIN_DURATION_SECONDS) {
        dbg.log1('parse_sts_duration: duration below minimum', duration_sec, 'min', config.STS_MIN_DURATION_SECONDS);
        throw new StsError(_sts_duration_validation_error(duration_input, 'greater', config.STS_MIN_DURATION_SECONDS));
    }
    if (duration_sec > max_duration) {
        dbg.log1('parse_sts_duration: duration above maximum', duration_sec, 'max', max_duration);
        throw new StsError(_sts_duration_validation_error(duration_input, 'less', max_duration));
    }
    return duration_sec * 1000;
}

/**
 * get_session_duration_info resolves session duration fields for AssumeRole responses
 * @param {String|undefined} duration_seconds
 * @param {Number} [role_max_session_duration]
 * @returns {{duration_sec: number, expiration_time: number}}
 */
function get_session_duration_info(duration_seconds, role_max_session_duration) {
    const duration_ms = parse_sts_duration(duration_seconds, role_max_session_duration);
    return {
        duration_sec: Math.ceil(duration_ms / 1000),
        expiration_time: Date.now() + duration_ms,
    };
}

function _sts_duration_validation_error(duration_input, constraint, constraint_value) {
    return {
        ...StsError.ValidationError,
        message: `Value ${duration_input} for durationSeconds failed to satisfy constraint: Member must have value ${constraint} than or equal to ${constraint_value}`,
    };
}

exports.generate_session_token = generate_session_token;
exports.parse_sts_duration = parse_sts_duration;
exports.get_session_duration_info = get_session_duration_info;
