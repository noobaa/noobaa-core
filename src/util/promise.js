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
P.config({
    longStackTraces: process.env.DEBUG_MODE === 'true',
    // warnings: true || {
    //     wForgottenReturn: false
    // },
});

P.promisifyAll(require('fs'));
P.promisifyAll(require('child_process'));

// TODO remove backward compatibility to Q functions
P.defer = function defer() {
    let callback;
    let promise = P.fromCallback(function(cb) {
        callback = cb;
    });
    return {
        resolve: res => callback(null, res),
        reject: err => callback(err),
        promise: promise
    };
};
P.fcall = function fcall() {
    var func = arguments[0];
    var args = Array.prototype.slice.call(arguments, 1);
    return P.try(() => func.apply(null, args));
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
        var Q = require('q');
        _.forIn(P, function(key, val) {
            Q[key] = val;
        });
    } catch (err) {
        // ignore
    }
};

P.hijackQ();
