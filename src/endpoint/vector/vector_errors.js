/* Copyright (C) 2025 NooBaa */
'use strict';
const xml_utils = require('../../util/xml_utils');

const error_type_enum = {
    SENDER: 'Sender',
    RECEIVER: 'Receiver',
    UNKNOWM: 'Unknown',
};

/**
 * @typedef {{
 *      code: string, 
 *      message: string, 
 *      http_code?: number,
 *      type?: string,
 * }} VectorErrorSpec
 */

class VectorError extends Error {

    /**
     * @param {VectorErrorSpec} error_spec
     */
    constructor({ code, message, http_code, type }) {
        super(message);
        this.code = code;
        this.http_code = http_code;
        this.type = type;
    }

    reply(request_id) {
        const xml = {
            ErrorResponse: {
                Error: {
                    Type: this.type,
                    Code: this.code,
                    Message: this.message,
                },
                RequestId: request_id || '',
            }
        };
        return xml_utils.encode_xml(xml);
    }

}

VectorError.AccessDeniedException = Object.freeze({
    code: 'AccessDeniedException',
    message: 'You do not have sufficient access to perform this action.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.IncompleteSignature = Object.freeze({
    code: 'IncompleteSignature',
    message: 'The request signature does not conform to AWS standards.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.InternalFailure = Object.freeze({
    code: 'InternalFailure',
    message: 'The request processing has failed because of an unknown error, exception or failure.',
    http_code: 500,
    type: error_type_enum.RECEIVER,
});
VectorError.InvalidAction = Object.freeze({
    code: 'InvalidAction',
    message: 'The action or operation requested is invalid. Verify that the action is typed correctly.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.InvalidClientTokenId = Object.freeze({
    code: 'InvalidClientTokenId',
    message: 'The X.509 certificate or AWS access key ID provided does not exist in our records.',
    http_code: 403,
    type: error_type_enum.SENDER,
});
VectorError.InvalidClientTokenIdInactiveAccessKey = Object.freeze({
    code: 'InvalidClientTokenId',
    message: 'The security token included in the request is invalid.',
    http_code: 403,
    type: error_type_enum.SENDER,
});
VectorError.NotAuthorized = Object.freeze({
    code: 'NotAuthorized',
    message: 'You do not have permission to perform this action.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.OptInRequired = Object.freeze({
    code: 'OptInRequired',
    message: 'The AWS access key ID needs a subscription for the service.',
    http_code: 403,
    type: error_type_enum.SENDER,
});
VectorError.RequestExpired = Object.freeze({
    code: 'RequestExpired',
    message: 'The request reached the service more than 15 minutes after the date stamp on the request or more than 15 minutes after the request expiration date (such as for pre-signed URLs), or the date stamp on the request is more than 15 minutes in the future.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.ServiceUnavailable = Object.freeze({
    code: 'ServiceUnavailable',
    message: 'The request has failed due to a temporary failure of the server.',
    http_code: 503,
    type: error_type_enum.RECEIVER,
});
VectorError.ThrottlingException = Object.freeze({
    code: 'ThrottlingException',
    message: 'The request was denied due to request throttling.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.ValidationError = Object.freeze({
    code: 'ValidationError',
    message: 'The input fails to satisfy the constraints specified by an AWS service.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
    type: error_type_enum.RECEIVER,
});
VectorError.InvalidParameterValue = Object.freeze({
    code: 'InvalidParameterValue',
    message: 'An invalid or out-of-range value was supplied for the input parameter.',
    http_code: 400,
    type: error_type_enum.SENDER,
});
VectorError.ExpiredToken = Object.freeze({
    code: 'ExpiredToken',
    message: 'The security token included in the request is expired',
    http_code: 400,
    type: error_type_enum.SENDER,
});


// EXPORTS
exports.VectorError = VectorError;
