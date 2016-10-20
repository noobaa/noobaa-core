/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
// const moment = require('moment');
const express = require('express');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);

function lambda_rest(controller) {

    let app = new express.Router();
    app.use(handle_options);
    // app.use(check_headers);
    // app.use(authenticate_request);

    app.get('/:api_version/functions',
        lambda_action('list_functions'));

    app.post('/:api_version/functions',
        read_json_body,
        lambda_action('create_function'));

    app.post('/:api_version/functions/:func_name/invocations',
        read_json_body,
        lambda_action('invoke'));

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
        dbg.log0('LAMBDA REQUEST', action_name, req.method, req.url, req.headers);
        let action = controller[action_name];
        if (!action) {
            dbg.error('LAMBDA TODO (NotImplemented)', action_name, req.method, req.url);
            next(new Error('NotImplemented'));
            return;
        }
        P.fcall(() => action.call(controller, req, res))
            .then(reply => {
                if (reply === false) {
                    // in this case the controller already replied
                    return;
                }
                dbg.log1('LAMBDA REPLY', action_name, req.method, req.url, reply);
                if (reply) {
                    dbg.log0('LAMBDA REPLY', action_name, req.method, req.url,
                        JSON.stringify(req.headers), reply);
                    res.status(200).send(reply);
                } else {
                    dbg.log0('LAMBDA EMPTY REPLY', action_name, req.method, req.url,
                        JSON.stringify(req.headers));
                    if (req.method === 'DELETE') {
                        res.status(204).end();
                    } else {
                        res.status(200).end();
                    }
                }
            })
            .catch(err => next(err));
    }

    /**
     * handle s3 errors and send the response xml
     */
    function handle_common_lambda_errors(err, req, res, next) {
        if (!err && next) {
            dbg.log0('LAMBDA DONE.', req.method, req.url);
            next();
        }
        dbg.error('LAMBDA ERROR', JSON.stringify(req.headers), err.stack || err);
        res.status(500).send('The AWS Lambda service encountered an internal error.');
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
            next();
        } catch (err) {
            next(err);
        }
    });
}


// EXPORTS
module.exports = lambda_rest;
