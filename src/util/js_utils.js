'use strict';

var _ = require('lodash');

module.exports = {
    self_bind: self_bind
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
 * see src/test/measure_bind_perf.js
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
