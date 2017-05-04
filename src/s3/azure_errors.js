/* Copyright (C) 2016 NooBaa */
'use strict';

const xml_utils = require('../util/xml_utils');

class AzureError extends Error {

    constructor(err) {
        super(err.message);
        this.code = err.code;
        this.http_code = err.http_code;
        if (err.reply) {
            this.reply = err.reply;
        }
    }

    reply() {
        return xml_utils.encode_xml({
            Error: {
                Code: this.code,
                Message: this.message,
            }
        });
    }

}

// See http://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html

const errors_defs = [{
    code: 'InternalError',
    message: 'The server encountered an internal error. Please retry the request.',
    http_code: 500,
}, {
    code: 'ContainerAlreadyExists',
    message: 'The specified container already exists.',
    http_code: 409,
}, {
    code: 'NotImplemented',
    message: 'functionality not implemented.',
    http_code: 501,
}, {
    code: 'InvalidBlobOrBlock',
    message: 'The specified blob or block content is invalid.',
    http_code: 400,
}];

for (const err_def of errors_defs) {
    AzureError[err_def.code] = err_def;
}

exports.AzureError = AzureError;
