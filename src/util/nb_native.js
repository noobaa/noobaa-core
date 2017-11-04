/* Copyright (C) 2016 NooBaa */
'use strict';


var _ = require('lodash');
var events = require('events');

var nb_native_napi;

function nb_native() {

    if (nb_native_napi) return nb_native_napi;

    const bindings = require('bindings'); // eslint-disable-line global-require
    nb_native_napi = bindings('nb_native.node');

    // see https://github.com/bnoordhuis/node-event-emitter
    const nb_native_nan = bindings('nb_native_nan.node');
    inherits(nb_native_nan.Nudp, events.EventEmitter);
    inherits(nb_native_nan.Ntcp, events.EventEmitter);
    _.defaults(nb_native_napi, nb_native_nan);

    return nb_native_napi;
}

// extend prototype
function inherits(target, source) {
    _.forIn(source.prototype, function(v, k) {
        target.prototype[k] = source.prototype[k];
    });
}

module.exports = nb_native;
