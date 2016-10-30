/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');

class LambdaError {

    constructor(err) {
        this.code = err.code;
        this.message = err.message;
        this.http_code = err.http_code;
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
}];

// return a map of code -> error object
const errors_map = _.mapValues(
    _.keyBy(errors_defs, 'code'),
    err => new LambdaError(err)
);

errors_map.LambdaError = LambdaError;

module.exports = errors_map;
