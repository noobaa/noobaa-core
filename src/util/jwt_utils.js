/* Copyright (C) 2016 NooBaa */
'use strict';

const jwt = require('jsonwebtoken');
const config = require('../../config');
const dbg = require('./debug_module')(__filename);

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
    // create and return the signed token
    return jwt.sign(object, get_jwt_secret(), jwt_options);
}

function make_internal_auth_token(object = {}, jwt_options = {}) {
    // Remote services/endpoints should not sign tokens
    if (config.NOOBAA_AUTH_TOKEN) return config.NOOBAA_AUTH_TOKEN;
    // If an auth token isn't provided, fall back to signing normally
    return make_auth_token(object, jwt_options);
}

/**
 * authorize jwt token. Validate the jwt token inside passed validate_jwt method
 * @param {string} token
 */
function authorize_jwt_token(token) {
    if (token && token.includes('Bearer ')) {
        token = token.split(' ')[1];
    }
    return jwt.verify(token, get_jwt_secret());
}

/**
 * autheticate jwt token for prometheus metrics and version request
 * @param {nb.S3Request} req
 */
function authenticate_jwt_token(req) {
    const token = req.headers.authorization;
    try {
        if (!token) {
            throw new Error('Missing authorization header');
        }
        const decoded = authorize_jwt_token(token);
        if (decoded.role !== "metrics-auth") {
            throw new Error("Role based authorization failed");
        }
    } catch (err) {
        dbg.error('JWT verification failed for token : ', token, err);
        throw err;
    }
}

exports.get_jwt_secret = get_jwt_secret;
exports.make_auth_token = make_auth_token;
exports.make_internal_auth_token = make_internal_auth_token;
exports.authorize_jwt_token = authorize_jwt_token;
exports.authenticate_jwt_token = authenticate_jwt_token;
