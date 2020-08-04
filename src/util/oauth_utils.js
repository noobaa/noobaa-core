/* Copyright (C) 2016 NooBaa */
'use strict';

const querystring = require('querystring');
const config = require('../../config');
const { make_https_request } = require('./http_utils');
const { read_stream_join } = require('./buffer_utils');

function _default_error_factory(message) {
    return new Error(message);
}

async function trade_grant_code_for_access_token(
    token_endpoint_addr,
    client_id,
    client_secret,
    redirect_host,
    grant_code,
    make_error = _default_error_factory
) {
    const token_endpoint = new URL(token_endpoint_addr);
    const redirect_uri = new URL(config.OAUTH_REDIRECT_ENDPOINT, redirect_host);
    let response;

    try {
        response = await make_https_request(
            {
                method: 'POST',
                port: token_endpoint.port || '443',
                hostname: token_endpoint.hostname,
                path: token_endpoint.pathname,
                rejectUnauthorized: false,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
                    'X-CSRF-Token': 'not-empty'
                }
            },
            querystring.stringify({
                grant_type: 'authorization_code',
                code: grant_code,
                client_id: client_id,
                client_secret: client_secret,
                redirect_uri: redirect_uri.toString()
            }),
            'utf8'
        );
    } catch (err) {
        throw make_error(`OpenShift api endpoint does not response, got: ${err.message}`);
    }

    const status_code = response.statusCode;
    const buffer = await read_stream_join(response);
    const body = buffer.toString('utf8');

    if (status_code !== 200) {
        throw make_error(`could not acquire an oauth access token, response status code was ${
            status_code
        } with a body of ${
            body
        }`);
    }

    try {
        const token_info = JSON.parse(body);
        const required_scope = config.OAUTH_REQUIRED_SCOPE;
        if (token_info.scope !== required_scope) {
             throw make_error(`user did not grant access for "${required_scope}" scope`);
        }
        if (token_info.token_type !== 'Bearer') {
            throw make_error('access token is not a of type "Bearer"');
        }
        return token_info;

    } catch (err) {
        throw make_error('mailformed access token json response');
    }
}

async function review_token(
    api_hostname,
    sa_token,
    oauth_access_token,
    api_port = '443',
    make_error = _default_error_factory
) {
    let response;
    try {
        response = await make_https_request(
            {
                method: 'POST',
                hostname: api_hostname,
                port: api_port,
                path: config.KUBE_API_ENDPOINTS.TOKEN_REVIEW,
                rejectUnauthorized: false,
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    Authorization: `Bearer ${sa_token}`
                }
            },
            JSON.stringify({
                apiVersion: 'authentication.k8s.io/v1',
                kind: 'TokenReview',
                spec: { token: oauth_access_token }
            }),
            'utf8'
       );

    } catch (err) {
        throw make_error('token review api endpoint does not response');
    }

    const status_code = response.statusCode;
    const buffer = await read_stream_join(response);
    const body = buffer.toString('utf8');

    if (status_code !== 200 && status_code !== 201) {
        throw make_error(`could not review oauth access token, response status code was ${
            status_code
        } with a body of ${
            body
        }`);
    }

    try {
        return JSON.parse(body);

    } catch (err) {
        throw make_error('malformed token review json response');
    }
}

exports.trade_grant_code_for_access_token = trade_grant_code_for_access_token;
exports.review_token = review_token;
