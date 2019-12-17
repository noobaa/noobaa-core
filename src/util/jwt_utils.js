/* Copyright (C) 2016 NooBaa */
'use strict';

/* eslint-disable global-require */

const jwt = require('jsonwebtoken');
const dbg = require('./debug_module')(__filename);
const JWT_SECRET = get_jwt_secret();

function get_jwt_secret() {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    } else {
        // in kubernetes we must have JWT_SECRET loaded from a kubernetes secret
        if (process.env.CONTAINER_PLATFORM === 'KUBERNETES') {
            throw new Error('JWT_SECRET env variable not found. it must exist when running in kuberentes');
        }
        // for all non kubernetes platforms (docker, local, etc.) return a dummy secret
        return 'abcdefgh';
    }
}

function make_auth_token(object = {}, jwt_options = {}) {
    // Remote services/endpoints should not sign tokens
    if (process.env.NOOBAA_AUTH_TOKEN) {
        return process.env.NOOBAA_AUTH_TOKEN;
    }
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
