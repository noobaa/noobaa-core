/* Copyright (C) 2016 NooBaa */
'use strict';
const xml_utils = require('../../util/xml_utils');

// https://docs.aws.amazon.com/STS/latest/APIReference/CommonErrors.html
/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail?: string
 * }} StsErrorSpec
 */

class StsError extends Error {

    /**
     * @param {StsErrorSpec} error_spec 
     */
    constructor({ code, message, http_code, detail }) {
        super(message); // sets this.message
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
    }

    reply(resource, request_id) {
        const xml = {
            Error: {
                Code: this.code,
                Message: this.message,
                Resource: resource || '',
                RequestId: request_id || '',
                Detail: this.detail,
            }
        };
        return xml_utils.encode_xml(xml);
    }

}

StsError.AccessDeniedException = Object.freeze({
    code: 'AccessDeniedException',
    message: 'You do not have sufficient access to perform this action.',
    http_code: 400,
});
StsError.IncompleteSignature = Object.freeze({
    code: 'IncompleteSignature',
    message: 'The request signature does not conform to AWS standards.',
    http_code: 400,
});
StsError.InternalFailure = Object.freeze({
    code: 'InternalFailure',
    message: 'The request processing has failed because of an unknown error, exception or failure.',
    http_code: 500,
});
StsError.InvalidAction = Object.freeze({
    code: 'InvalidAction',
    message: 'The action or operation requested is invalid. Verify that the action is typed correctly.',
    http_code: 400,
});
StsError.InvalidClientTokenId = Object.freeze({
    code: 'InvalidClientTokenId',
    message: 'The X.509 certificate or AWS access key ID provided does not exist in our records.',
    http_code: 403,
});
StsError.InvalidParameterCombination = Object.freeze({
    code: 'InvalidParameterCombination',
    message: 'Parameters that must not be used together were used together.',
    http_code: 400,
});
StsError.InvalidParameterValue = Object.freeze({
    code: 'InvalidParameterValue',
    message: 'An invalid or out-of-range value was supplied for the input parameter.',
    http_code: 400,
});
StsError.InvalidQueryParameter = Object.freeze({
    code: 'InvalidQueryParameter',
    message: 'The AWS query string is malformed or does not adhere to AWS standards.',
    http_code: 400,
});
StsError.MalformedQueryString = Object.freeze({
    code: 'MalformedQueryString',
    message: 'The query string contains a syntax error.',
    http_code: 404,
});
StsError.MissingAction = Object.freeze({
    code: 'MissingAction',
    message: 'The request is missing an action or a required parameter.',
    http_code: 400,
});
StsError.MissingAuthenticationToken = Object.freeze({
    code: 'MissingAuthenticationToken',
    message: 'The request must contain either a valid (registered) AWS access key ID or X.509 certificate.',
    http_code: 403,
});
StsError.MissingParameter = Object.freeze({
    code: 'MissingParameter',
    message: 'A required parameter for the specified action is not supplied.',
    http_code: 400,
});
StsError.NotAuthorized = Object.freeze({
    code: 'NotAuthorized',
    message: 'You do not have permission to perform this action.',
    http_code: 400,
});
StsError.OptInRequired = Object.freeze({
    code: 'OptInRequired',
    message: 'The AWS access key ID needs a subscription for the service.',
    http_code: 403,
});
StsError.RequestExpired = Object.freeze({
    code: 'RequestExpired',
    message: 'The request reached the service more than 15 minutes after the date stamp on the request or more than 15 minutes after the request expiration date (such as for pre-signed URLs), or the date stamp on the request is more than 15 minutes in the future.',
    http_code: 400,
});
StsError.ServiceUnavailable = Object.freeze({
    code: 'ServiceUnavailable',
    message: 'The request has failed due to a temporary failure of the server.',
    http_code: 503,
});
StsError.ThrottlingException = Object.freeze({
    code: 'ThrottlingException',
    message: 'The request was denied due to request throttling.',
    http_code: 400,
});
StsError.ValidationError = Object.freeze({
    code: 'ValidationError',
    message: 'The input fails to satisfy the constraints specified by an AWS service.',
    http_code: 400,
});
StsError.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
});
StsError.ExpiredToken = Object.freeze({
    code: 'ExpiredToken',
    message: 'The security token included in the request is expired',
    http_code: 400,
});
exports.StsError = StsError;
