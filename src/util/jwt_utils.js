/* Copyright (C) 2016 NooBaa */
'use strict';

/* eslint-disable global-require */

const jwt = require('jsonwebtoken');
const config = require('../../config');
const dbg = require('./debug_module')(__filename);
const JWT_SECRET = get_jwt_secret();

function get_jwt_secret() {
    if (config.JWT_SECRET) return config.JWT_SECRET;
    // in kubernetes we must have JWT_SECRET loaded from a kubernetes secret
    if (process.env.CONTAINER_PLATFORM === 'KUBERNETES') {
        throw new Error('jwt_secret mounted to a file was not found. it must exist when running in kubernetes');
    }
    // for all non kubernetes platforms (docker, local, etc.) return a dummy secret
    return 'abcdefgh';
}

function make_auth_token(object = {}, jwt_options = {}) {
    // Remote services/endpoints should not sign tokens
    if (config.NOOBAA_AUTH_TOKEN) return config.NOOBAA_AUTH_TOKEN;
    // create and return the signed token
    return jwt.sign(object, JWT_SECRET, jwt_options);
}

function authorize_jwt_token(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        dbg.error('JWT VERIFY FAILED', token, err);
        throw err;
    }
}

exports.get_jwt_secret = get_jwt_secret;
exports.make_auth_token = make_auth_token;
exports.authorize_jwt_token = authorize_jwt_token;
