'use strict';

var P = require('bluebird');
var _ = require('lodash');
require('setimmediate');

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
// using setImmediate to allow modules to change the env on startup
if (process.env.DEBUG_MODE === 'true') {
    P.longStackTraces();
}

P.promisifyAll(require('fs'));
P.promisifyAll(require('child_process'));

// aliases from Q
P.when = P.resolve;
P.allSettled = P.settle;
P.prototype.fin = P.prototype.finally;
P.prototype.fail = P.prototype.catch;
P.prototype.thenResolve = P.prototype.return;

// functions from Q
P.defer = function defer() {
    var ret = {};
    var promise = new P(function(resolve, reject) {
        ret.resolve = ret.fulfill = resolve;
        ret.reject = reject;
    });
    ret.promise = promise;
    ret.notify = promise._progress.bind(promise);
    return ret;
};
P.fcall = function fcall() {
    var func = arguments[0];
    var args = Array.prototype.slice.call(arguments, 1);
    return P.try(func, args);
};
P.invoke = function invoke() {
    var obj = arguments[0];
    var func_name = arguments[1];
    var args = Array.prototype.slice.call(arguments, 2);
    return P.try(obj[func_name], args, obj);
};
P.nfcall = function nfcall() {
    var func = arguments[0];
    var args = Array.prototype.slice.call(arguments, 1);
    /*
    return P.promisify(func).apply(null, args);
    */
    return P.fromNode(function nfcall_fromNode(callback) {
        args.push(callback);
        func.apply(null, args);
    });
};
P.ninvoke = function ninvoke() {
    var obj = arguments[0];
    var func_name = arguments[1];
    var args = Array.prototype.slice.call(arguments, 2);
    /*
    return P.promisify(obj[func_name]).apply(obj, args);
    */
    return P.fromNode(function ninvoke_fromNode(callback) {
        args.push(callback);
        obj[func_name].apply(obj, args);
    });
};
P.npost = function npost() {
    var obj = arguments[0];
    var func_name = arguments[1];
    var args = arguments[2];
    /*
    return P.promisify(obj[func_name]).apply(obj, args);
    */
    return P.fromNode(function npost_fromNode(callback) {
        if (args) {
            args = args.slice(); // copy
            args.push(callback);
        } else {
            args = [callback];
        }
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
