'use strict';

var _ = require('lodash');
var dbg = require('noobaa-util/debug_module')(__filename);


module.exports = {
    self_bind: self_bind,
    diff_arrays: diff_arrays
};


/**
 *
 * self_bind
 *
 * create a lightweight bind which is based on simple closure of the object.
 *
 * the native Function.bind() produces a function with very slow performance,
 * the reason for that seems to be that the spec for bind() is bigger than simple closure.
 *
 * see http://stackoverflow.com/questions/17638305/why-is-bind-slower-than-a-closure
 *
 * see src/test/test_bind_perf.js
 *
 * @param method_desc optional string or array of strings of method names
 *      to bind, if not supplied all enumerable functions will be used.
 */
function self_bind(object, method_desc) {
    if (!_.isString(method_desc)) {
        method_desc = method_desc || _.functions(object);
        _.each(method_desc, function(method) {
            self_bind(object, method);
        });
        return;
    }

    var func = object[method_desc];

    // create a closure function that applies the original function on object
    function closure_func() {
        return func.apply(object, arguments);
    }

    object[method_desc] = closure_func;

    return closure_func;
}

//Recieve two array and a comperator
//Comperator definition: (a<b) return -1, (a>b) return 1, (a===b) return 0
//Return uniq items in arr1 and uniq items in arr2
function diff_arrays(arr1, arr2, comp) {
    var uniq_1 = [],
        uniq_2 = [];
    var pos1 = 0,
        pos2 = 0;

    if (!_.isFunction(comp)) {
        throw new Error('Comp must be a comperator function');
    }
    if (arr1.length === 0 || arr2.length === 0) {
        return {
            uniq_a: arr1,
            uniq_b: arr2
        };
    }

    if (arr1.length === 0 || arr2.length === 0) {
        return {
            uniq_a: arr1,
            uniq_b: arr2
        };
    }

    while (comp(arr1[pos1], arr2[pos2]) === -1) {
        uniq_1.push(arr1[pos1]);
        pos1++;
    }

    while (pos1 < arr1.length && pos2 < arr2.length) {
        if (comp(arr1[pos1], arr2[pos2]) === -1) {
            uniq_1.push(arr1[pos1]);
            pos1++;
        } else if (comp(arr1[pos1], arr2[pos2]) === 1) {
            uniq_2.push(arr2[pos2]);
            pos2++;
        } else {
            pos1++;
            pos2++;
        }
    }

    //Handle tails
    for (; pos1 < arr1.length; ++pos1) {
        uniq_1.push(arr1[pos1]);
        pos1++;
    }

    for (; pos2 < arr2.length; ++pos2) {
        uniq_2.push(arr2[pos2]);
        pos2++;
    }

    dbg.log4('diff_arrays recieved arr1 #', arr1.length, 'arr2 #', arr2.length, 'returns uniq_1', uniq_1, 'uniq_2', uniq_2);

    return {
        uniq_a: uniq_1,
        uniq_b: uniq_2
    };
}
