'use strict';

var _ = require('lodash');
var Q = require('q');
var Promise = require('bluebird');

/**
 *
 * TODO this module is a temporary hack and should be removed once we switch existing code to bluebird
 *
 * this module hijacks Q promises and replaces it with bluebird promises
 * since Q are extremely slow and waste a lot of cpu.
 * see this:
 * https://github.com/petkaantonov/bluebird/issues/381
 * https://github.com/petkaantonov/bluebird/issues/63
 *
 * notice that we do not handle calls to the function Q() itself because
 * we did not hijack the module reference, only its content.
 *
 */
module.exports = Promise;

// Promise.longStackTraces();
// Q.longStackSupport = true;

Q.Promise = function(func) {
    return new Promise(func);
};
Q.when = Promise.resolve;
Q.resolve = Promise.resolve;
Q.reject = Promise.reject;
Q.defer = function defer() {
    var resolve, reject;
    var promise = new Promise(function() {
        resolve = arguments[0];
        reject = arguments[1];
    });
    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
};
Q.fcall = function() {
    var args = _.toArray(arguments);
    return Promise.try(args[0], args.slice(1));
};
Q.invoke = function() {
    var args = _.toArray(arguments);
    return Promise.try(args[0][args[1]], args.slice(2), args[0]);
};
Q.delay = Promise.delay;
Q.timeout = Promise.timeout;
Q.all = Promise.all;
Q.allSettled = Promise.settle;
Q.nfcall = function( /*func, args...*/ ) {
    var args = _.toArray(arguments);
    return Promise.fromNode(function(callback) {
        var fargs = args.slice(1);
        fargs.push(callback);
        args[0].apply(null, fargs);
    });
};
Q.ninvoke = function() {
    var args = _.toArray(arguments);
    return Promise.fromNode(function(callback) {
        var fargs = args.slice(2);
        fargs.push(callback);
        args[0][args[1]].apply(args[0], fargs);
    });
};
Q.npost = function() {
    var args = _.toArray(arguments);
    return Promise.fromNode(function(callback) {
        var fargs = args[2] ? args[2].slice() : [];
        fargs.push(callback);
        args[0][args[1]].apply(args[0], fargs);
    });
};
Promise.prototype.fin = Promise.prototype.finally;
Promise.prototype.fail = Promise.prototype.catch;
Promise.prototype.thenResolve = Promise.prototype.return;
Q.prototype = Promise.prototype;
