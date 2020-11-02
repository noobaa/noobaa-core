/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail?: string
 * }} LambdaErrorSpec
 */

class LambdaError extends Error {

    /**
     * @param {LambdaErrorSpec} error_spec 
     */
    constructor({ code, message, http_code, detail }) {
        super(message); // sets this.message
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
    }

    reply() {
        return JSON.stringify({
            Message: this.message
        });
    }

}

LambdaError.CodeStorageExceededException = Object.freeze({
    code: 'CodeStorageExceededException',
    message: 'You have exceeded your maximum total code size per account.',
    http_code: 400,
});
LambdaError.InvalidParameterValueException = Object.freeze({
    code: 'InvalidParameterValueException',
    message: 'One of the parameters in the request is invalid.',
    http_code: 400,
});
LambdaError.ResourceConflictException = Object.freeze({
    code: 'ResourceConflictException',
    message: 'The resource already exists.',
    http_code: 409,
});
LambdaError.ResourceNotFoundException = Object.freeze({
    code: 'ResourceNotFoundException',
    message: 'The resource specified in the request does not exist.',
    http_code: 404,
});
LambdaError.RequestTooLargeException = Object.freeze({
    code: 'RequestTooLargeException',
    message: 'The request payload exceeded the Invoke request body JSON input limit.',
    http_code: 413,
});
LambdaError.ServiceException = Object.freeze({
    code: 'ServiceException',
    message: 'The AWS Lambda service encountered an internal error.',
    http_code: 500,
});
LambdaError.TooManyRequestsException = Object.freeze({
    code: 'TooManyRequestsException',
    message: 'TooManyRequestsException.',
    http_code: 429,
});
LambdaError.UnsupportedMediaTypeException = Object.freeze({
    code: 'UnsupportedMediaTypeException',
    message: 'The content type of the Invoke request body is not JSON.',
    http_code: 415,
});
LambdaError.RequestTimeTooSkewed = Object.freeze({
    code: 'RequestTimeTooSkewed',
    message: 'The difference between the request time and the server\'s time is too large.',
    http_code: 403,
});
LambdaError.AccessDenied = Object.freeze({
    code: 'AccessDenied',
    message: 'Access Denied',
    http_code: 403,
});
LambdaError.SignatureDoesNotMatch = Object.freeze({
    code: 'SignatureDoesNotMatch',
    message: 'The request signature we calculated does not match the signature you provided. Check your AWS secret access key and signing method. For more information, see REST Authentication and SOAP Authentication for details.',
    http_code: 403,
});
LambdaError.MissingRequestBodyError = Object.freeze({
    code: 'MissingRequestBodyError',
    message: 'Request body is empty.',
    http_code: 400,
});
LambdaError.InvalidRequest = Object.freeze({
    code: 'InvalidRequest',
    message: 'The content type of the request is not JSON.',
    http_code: 400,
});
LambdaError.InvalidDigest = Object.freeze({
    code: 'InvalidDigest',
    message: 'The Content-MD5 you specified is not valid.',
    http_code: 400,
});
LambdaError.MaxMessageLengthExceeded = Object.freeze({
    code: 'MaxMessageLengthExceeded',
    message: 'Your request was too big.',
    http_code: 400,
});

////////////////////////////////////////////////////////////////
// Errors actually returned by AWS S3 although not documented //
////////////////////////////////////////////////////////////////

LambdaError.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'A header you provided implies functionality that is not implemented.',
    http_code: 501,
});
LambdaError.BadRequestWithoutCode = Object.freeze({
    // same as BadRequest but without encoding the <Code> field
    // was needed for one of the cases in ceph/s3tests
    message: 'Bad Request',
    http_code: 400,
});
LambdaError.XAmzContentSHA256Mismatch = Object.freeze({
    code: 'XAmzContentSHA256Mismatch',
    message: 'The provided \'x-amz-content-sha256\' header does not match what was computed.',
    http_code: 400,
    // ClientComputedContentSHA256: '...',
    // S3ComputedContentSHA256: '...',
});

exports.LambdaError = LambdaError;
