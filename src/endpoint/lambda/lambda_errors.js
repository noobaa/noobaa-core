/* Copyright (C) 2016 NooBaa */
'use strict';

class LambdaError extends Error {

    constructor(err) {
        super(err.message);
        this.code = err.reply_without_code ? undefined : err.code;
        this.http_code = err.http_code;
        if (err.reply) {
            this.reply = err.reply;
        }
    }

    reply() {
        return JSON.stringify({
            Message: this.message
        });
    }

}

const errors_defs = [{
    code: 'CodeStorageExceededException',
    message: 'You have exceeded your maximum total code size per account.',
    http_code: 400,
}, {
    code: 'InvalidParameterValueException',
    message: 'One of the parameters in the request is invalid.',
    http_code: 400,
}, {
    code: 'ResourceConflictException',
    message: 'The resource already exists.',
    http_code: 409,
}, {
    code: 'ResourceNotFoundException',
    message: 'The resource specified in the request does not exist.',
    http_code: 404,
}, {
    code: 'RequestTooLargeException',
    message: 'The request payload exceeded the Invoke request body JSON input limit.',
    http_code: 413,
}, {
    code: 'ServiceException',
    message: 'The AWS Lambda service encountered an internal error.',
    http_code: 500,
}, {
    code: 'TooManyRequestsException',
    message: 'TooManyRequestsException.',
    http_code: 429,
}, {
    code: 'UnsupportedMediaTypeException',
    message: 'The content type of the Invoke request body is not JSON.',
    http_code: 415,
}, {
    code: 'RequestTimeTooSkewed',
    message: 'The difference between the request time and the server\'s time is too large.',
    http_code: 403,
}, {
    code: 'AccessDenied',
    message: 'Access Denied',
    http_code: 403,
}, {
    code: 'SignatureDoesNotMatch',
    message: 'The request signature we calculated does not match the signature you provided. Check your AWS secret access key and signing method. For more information, see REST Authentication and SOAP Authentication for details.',
    http_code: 403,
}, {
    code: 'MissingRequestBodyError',
    message: 'Request body is empty.',
    http_code: 400,
}, {
    code: 'InvalidRequest',
    message: 'The content type of the request is not JSON.',
    http_code: 400,
}, {
    code: 'InvalidDigest',
    message: 'The Content-MD5 you specified is not valid.',
    http_code: 400,
}, {
    code: 'MaxMessageLengthExceeded',
    message: 'Your request was too big.',
    http_code: 400,
}, {
    // not defined in AWS list
    // needed for error cases that require no code in the reply
    reply_without_code: true,
    code: 'BadRequestWithoutCode',
    message: 'Bad Request',
    http_code: 400,
}, {
    // not defined in AWS docs but this is what they return
    code: 'XAmzContentSHA256Mismatch',
    message: 'The provided \'x-amz-content-sha256\' header does not match what was computed.',
    http_code: 400,
    // ClientComputedContentSHA256: '...',
    // S3ComputedContentSHA256: '...',
}];

for (const err_def of errors_defs) {
    LambdaError[err_def.code] = err_def;
}

exports.LambdaError = LambdaError;
