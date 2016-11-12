/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
// const moment = require('moment');
const crypto = require('crypto');
const express = require('express');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../util/s3_utils');
const lambda_errors = require('./lambda_errors');

const RPC_ERRORS_TO_LAMBDA = Object.freeze({
    UNAUTHORIZED: lambda_errors.AccessDenied,
    FORBIDDEN: lambda_errors.AccessDenied,
    NO_SUCH_LAMBDA_FUNC: lambda_errors.ResourceNotFoundException,
    CONFLICT: lambda_errors.ResourceConflictException,
});


function lambda_rest(controller) {

    let app = new express.Router();
    app.use(handle_options);
    // app.use(check_headers);
    app.use(read_json_body);
    app.use(authenticate_lambda_request);

    app.get('/',
        lambda_action('list_funcs'));

    app.post('/',
        lambda_action('create_func'));

    app.get('/:func_name',
        lambda_action('read_func'));

    app.delete('/:func_name',
        lambda_action('delete_func'));

    app.post('/:func_name/invocations',
        lambda_action('invoke_func'));

    app.use(handle_common_lambda_errors);
    return app;


    /**
     * returns a route handler for the given function
     * the queries are optional list of sub queries that
     * will be checked in the req.query and change the
     * called function accordingly.
     */
    function lambda_action(action_name, queries) {
        return function(req, res, next) {
            lambda_call(action_name, req, res, next);
        };
    }

    /**
     * call a function in the controller, and send the result
     */
    function lambda_call(action_name, req, res, next) {
        dbg.log0('LAMBDA REQUEST', action_name, req.method, req.originalUrl, req.headers);
        let action = controller[action_name];
        if (!action) {
            dbg.error('LAMBDA TODO (NotImplemented)', action_name, req.method, req.originalUrl);
            next(new Error('NotImplemented'));
            return;
        }
        P.fcall(() => action.call(controller, req, res))
            .then(reply => {
                dbg.log1('LAMBDA REPLY', action_name, req.method, req.originalUrl, reply);
                if (!res.statusCode) {
                    if (req.method === 'POST') {
                        // HTTP Created is the common reply to POST method
                        // BUT some APIs might require 200 or 202
                        res.statusCode = 201;
                    } else if (req.method === 'DELETE') {
                        // HTTP No Content is the common reply to DELETE method
                        // BUT some APIs might require 200 or 202
                        res.statusCode = 204;
                    } else {
                        // HTTP OK for GET, PUT, HEAD, OPTIONS
                        res.statusCode = 200;
                    }
                }
                if (reply) {
                    dbg.log0('LAMBDA REPLY', action_name, req.method, req.originalUrl,
                        JSON.stringify(req.headers), reply);
                    res.send(reply);
                } else {
                    dbg.log0('LAMBDA EMPTY REPLY', action_name, req.method, req.originalUrl,
                        JSON.stringify(req.headers));
                    res.end();
                }
            })
            .catch(err => next(err));
    }


    /**
     * handle s3 errors and send the response xml
     */
    function handle_common_lambda_errors(err, req, res, next) {
        if (!err) {
            dbg.log0('LAMBDA Unknown API', req.method, req.originalUrl);
            err = lambda_errors.ServiceException;
        }
        let lambda_err =
            ((err instanceof lambda_errors.LambdaError) && err) ||
            RPC_ERRORS_TO_LAMBDA[err.rpc_code] ||
            lambda_errors.ServiceException;
        dbg.error('LAMBDA ERROR', lambda_err,
            JSON.stringify(req.headers),
            err.stack || err);
        res.status(lambda_err.http_code).send({
            Message: lambda_err.message
        });
    }

    /**
     * check the signature of the request
     */
    function authenticate_lambda_request(req, res, next) {
        P.fcall(function() {
                s3_utils.authenticate_request(req);
                return controller.prepare_request(req);
            })
            .then(() => next())
            .catch(err => {
                dbg.error('authenticate_s3_request: ERROR', err.stack || err);
                next(new Error('Unauthorized Lambda Request!'));
            });
    }

}

function handle_options(req, res, next) {
    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers',
        'Content-Type,Authorization,X-Amz-User-Agent,X-Amz-Date,ETag,X-Amz-Content-Sha256');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');

    if (req.method === 'OPTIONS') {
        dbg.log0('OPTIONS!');
        res.status(200).end();
        return;
    }

    // these are the default and might get overriden by api's that
    // return actual data in the reply instead of xml
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('ETag', '"1"');

    req.request_id = Date.now().toString(36);
    res.setHeader('x-amz-request-id', req.request_id);
    res.setHeader('x-amz-id-2', req.request_id);

    next();
}

function read_json_body(req, res, next) {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', function(chunk) {
        data += chunk;
    });
    req.on('end', function() {
        try {
            if (data) {
                req.body = JSON.parse(data);
            }
            const content_sha256_hex = req.headers['x-amz-content-sha256'];
            req.content_sha256 =
                content_sha256_hex ? new Buffer(content_sha256_hex, 'hex') :
                (crypto.createHash('sha256')
                    .update(data)
                    .digest());
            console.log('GGG', req.content_sha256, data);
            return next();
        } catch (err) {
            return next(err);
        }
    });
}


// EXPORTS
module.exports = lambda_rest;
