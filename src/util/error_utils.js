/* Copyright (C) 2023 NooBaa */
'use strict';

/** @typedef {Error & { code: string }} ErrorWithCode */

/**
 * Create a simple error with an error code.
 * The code field is meant to be used for detecting the exact error type.
 * @see https://nodejs.org/dist/latest-v18.x/docs/api/errors.html#errorcode
 * @param {string} code a machine readable error code, e.g 'NOT_FOUND'.
 * @param {string} [message] a human readable error message, e.g 'No such bucket'.
 * @param {ErrorOptions} [options]
 * @returns {ErrorWithCode}
 */
function new_error_code(code, message, options) {
    return Object.assign(new Error(message ?? code, options), { code });
}

/**
 * Remove the stack trace for errors that are too noisy with a stack.
 * @param {Error} err 
 */
function stackless(err) {
    err.stack = null;
    return err;
}

exports.new_error_code = new_error_code;
exports.stackless = stackless;
