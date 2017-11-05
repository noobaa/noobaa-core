/* Copyright (C) 2016 NooBaa */
'use strict';

var P = require('bluebird');
var _ = require('lodash');

/**
 *
 * Promise model
 *
 * currently uses bluebird for it's high performance and low overhead compared to the popular Q.
 *
 * see here:
 * https://github.com/petkaantonov/bluebird/issues/381
 * https://github.com/petkaantonov/bluebird/issues/63
 *
 */
module.exports = P;

// better stack traces for promises
// used for testing only to avoid its big mem & cpu overheads
if (process.env.DEBUG_MODE === 'true') {
    console.log('Promise with longStackTraces on DEBUG_MODE');
}

// see http://bluebirdjs.com/docs/api/promise.config.html
P.config({
    longStackTraces: process.env.DEBUG_MODE === 'true',
    warnings: {
        // this enables all warnings except forgotten return statements
        // the reason to disable wForgottenReturn is that it's impossible
        // to suppress it for the defer() impl below
        wForgottenReturn: false
    },
    cancellation: false,
    monitoring: false
});

P.promisifyAll(require('fs'));
P.promisifyAll(require('child_process'));

// TODO remove backward compatibility to Q functions
P.defer = function defer() {
    // see! http://bluebirdjs.com/docs/api/deferred-migration.html
    let resolve;
    let reject;
    let promise = new P(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
};
P.fcall = function fcall() {
    var func = arguments[0];
    var args = Array.prototype.slice.call(arguments, 1);
    return P.resolve().then(() => func.apply(null, args));
};
P.nfcall = function nfcall() {
    var func = arguments[0];
    var args = Array.prototype.slice.call(arguments, 1);
    return P.fromCallback(function nfcall_fromCallback(callback) {
        args.push(callback);
        func.apply(null, args);
    });
};
P.ninvoke = function ninvoke() {
    var obj = arguments[0];
    var func_name = arguments[1];
    var args = Array.prototype.slice.call(arguments, 2);
    return P.fromCallback(function ninvoke_fromCallback(callback) {
        args.push(callback);
        obj[func_name].apply(obj, args);
    });
};
P.hijackQ = function hijackQ() {
    try {
        // the reason we define the module name as a variable
        // is to avoid browserify loading it to the bundle
        const q_module_name = 'q';
        const Q = require(q_module_name); // eslint-disable-line global-require
        _.forIn(P, function(key, val) {
            Q[key] = val;
        });
    } catch (err) {
        // ignore
    }
};

P.hijackQ();
