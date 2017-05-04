/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const xml2js = require('xml2js');
const express = require('express');
const uuid = require('node-uuid');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
// const config = require('../../config');
const AzureError = require('./azure_errors').AzureError;
const xml_utils = require('../util/xml_utils');
const auth_server = require('../server/common_services/auth_server');
const system_store = require('../server/system_services/system_store').get_instance();
// const time_utils = require('../util/time_utils');
// const signature_utils = require('../util/signature_utils');


const AZURE_XML_ATTRS = Object.freeze({
    ServiceEndpoint: 'http://azure.noobaa/'
});


const RPC_ERRORS_TO_AZURE = Object.freeze({
    BUCKET_ALREADY_EXISTS: AzureError.ContainerAlreadyExists,
});




function azure_rest(controller) {

    let app = new express.Router();
    app.use((req, res, next) => {
        if (!req.headers['x-ms-version']) {
            return next(new Error('S3_REQUEST'));
        }
        return next();
    });
    app.use(handle_options);
    // app.use(check_headers);
    // app.use(handle_testme);
    app.use(authenticate_azure_request);
    app.get('/', azure_handler('list_containers'));
    app.head('/:container', azure_handler('get_container_properties'));
    app.get('/:container', azure_handler('get_container'));
    app.put('/:container', azure_handler('put_container'));
    // app.post('/:bucket', prepare_post_bucket_req, s3_handler('post_bucket', ['delete']));
    // app.delete('/:bucket', s3_handler('delete_bucket', BUCKET_QUERIES));
    app.head('/:bucket/:key(*)', azure_handler('get_blob_properties'));
    app.get('/:bucket/:key(*)', azure_handler('get_blob'));
    app.put('/:bucket/:key(*)', azure_handler('put_blob'));
    // app.post('/:bucket/:key(*)', prepare_post_object_req, s3_handler('post_object', ['uploadId', 'uploads']));
    // app.delete('/:bucket/:key(*)', s3_handler('delete_object', ['uploadId']));
    app.use(handle_common_azure_errors);
    return app;


    /**
     * returns a route handler for the given function
     * the queries are optional list of sub queries that
     * will be checked in the req.query and change the
     * called function accordingly.
     */
    function azure_handler(func_name, queries) {
        return function(req, res, next) {
            let found_query = queries && _.find(queries, q => {
                if (q in req.query) {
                    azure_call(func_name + '_' + q, req, res, next);
                    return true; // break from _.find
                }
            });
            if (!found_query) {
                azure_call(func_name, req, res, next);
            }
        };
    }

    /**
     * call a function in the controller, and prepare the result
     * to send as xml.
     */
    function azure_call(func_name, req, res, next) {
        dbg.log0('AZURE REQUEST', func_name, req.method, req.originalUrl, req.headers);
        let func = controller[func_name];
        if (!func) {
            dbg.error('AZURE TODO (NotImplemented)', func_name, req.method, req.originalUrl);
            next(new AzureError(AzureError.NotImplemented));
            return;
        }
        P.fcall(() => func.call(controller, req, res))
            .then(reply => {
                if (reply === false) {
                    // in this case the controller already replied
                    return;
                }
                dbg.log1('AZURE REPLY', func_name, req.method, req.originalUrl, reply);
                if (reply) {
                    let _attr = {
                        ServiceEndpoint: AZURE_XML_ATTRS.ServiceEndpoint
                    };
                    if (reply.container) {
                        _attr.ContainerName = reply.container;
                        delete reply.container;
                    }
                    let xml_root = _.mapValues(reply, val => ({
                        _attr,
                        _content: val
                    }));
                    let xml_reply = xml_utils.encode_xml(xml_root);
                    dbg.log0('AZURE XML REPLY', func_name, req.method, req.originalUrl,
                        JSON.stringify(res._headers), xml_reply);
                    res.status(200).send(xml_reply);
                } else {
                    dbg.log0('AZURE EMPTY REPLY', func_name, req.method, req.originalUrl,
                        JSON.stringify(res._headers));
                    if (res.created) {
                        res.status(201).end();
                    } else {
                        res.status(200).end();
                    }
                }
            })
            .catch(err => next(err));
    }

    /**
     * TODO: fix authentication. currently autherizes everything.
     */
    function authenticate_azure_request(req, res, next) {
        P.fcall(function() {
                let system = system_store.data.systems[0];
                req.auth_token = auth_server.make_auth_token({
                    system_id: system._id,
                    account_id: system.owner._id,
                    role: 'admin'
                });
                return controller.prepare_request(req);
            })
            .then(() => next())
            .catch(err => {
                dbg.error('authenticate_azure_request: ERROR', err.stack || err);
                next(new AzureError(AzureError.InternalError));
            });
    }

    /**
     * handle s3 errors and send the response xml
     */
    function handle_common_azure_errors(err, req, res, next) {
        if (!err) {
            dbg.log0('Azure InvalidURI.', req.method, req.originalUrl);
            err = new AzureError(AzureError.InternalError);
        }
        if (err.message === 'S3_REQUEST') {
            return next();
        }
        if (err.rpc_code === 'NO_SUCH_BUCKET') {
            res.status(404).send('The specified container does not exist.');
        }
        let azure_err =
            ((err instanceof AzureError) && err) ||
            new AzureError(RPC_ERRORS_TO_AZURE[err.rpc_code] || AzureError.InternalError);
        let reply = azure_err.reply();
        dbg.error('AZURE ERROR', reply,
            req.method, req.originalUrl,
            JSON.stringify(req.headers),
            err.stack || err);
        // This doesn't need to affect response if we fail to register
        res.status(azure_err.http_code).send(reply);
    }
}


function handle_options(req, res, next) {
    // note that browsers will not allow origin=* with credentials
    // but anyway we allow it by the agent server.

    // these are the default and might get overriden by api's that
    // return actual data in the reply instead of xml
    res.setHeader('ETag', '"1"');
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('x-ms-version', req.headers['x-ms-version']);

    req.request_id = Date.now().toString(36);
    res.setHeader('x-ms-request-id', uuid());
    res.setHeader('Date', (new Date()).toUTCString());

    // replace hadoop _$folder$
    if (req.params.key) {
        req.params.key = req.params.key.replace(/_\$folder\$/, '/');
    }

    next();
}


// EXPORTS
module.exports = azure_rest;
