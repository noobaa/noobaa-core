/* Copyright (C) 2016 NooBaa */
'use strict';

const xml_utils = require('../../util/xml_utils');

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail?: string
 * }} BlobErrorSpec
 */

class BlobError extends Error {

    /**
     * @param {BlobErrorSpec} error_spec 
     */
    constructor({ code, message, http_code, detail }) {
        super(message); // sets this.message
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
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

/**
 * https://docs.microsoft.com/en-us/rest/api/storageservices/common-rest-api-error-codes
 * https://docs.microsoft.com/en-us/rest/api/storageservices/blob-service-error-codes
 */
BlobError.InternalError = Object.freeze({
    code: 'InternalError',
    message: 'The server encountered an internal error. Please retry the request.',
    http_code: 500,
});
BlobError.ContainerAlreadyExists = Object.freeze({
    code: 'ContainerAlreadyExists',
    message: 'The specified container already exists.',
    http_code: 409,
});
BlobError.ContainerNotFound = Object.freeze({
    code: 'ContainerNotFound',
    message: 'The specified container does not exist.',
    http_code: 404,
});
BlobError.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'functionality not implemented.',
    http_code: 501,
});
BlobError.InvalidBlobOrBlock = Object.freeze({
    code: 'InvalidBlobOrBlock',
    message: 'The specified blob or block content is invalid.',
    http_code: 400,
});
BlobError.InvalidHeaderValue = Object.freeze({
    code: 'InvalidHeaderValue',
    message: 'The value provided for one of the HTTP headers was not in the correct format.',
    http_code: 400,
});
BlobError.OutOfRangeQueryParameterValue = Object.freeze({
    code: 'OutOfRangeQueryParameterValue',
    message: 'A query parameter specified in the request URI is outside the permissible range.',
    http_code: 400,
});
BlobError.BlobNotFound = Object.freeze({
    code: 'BlobNotFound',
    message: 'The specified blob does not exist.',
    http_code: 404,
});

exports.BlobError = BlobError;
