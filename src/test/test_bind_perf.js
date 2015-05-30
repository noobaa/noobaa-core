'use strict';

var _ = require('lodash');
var js_utils = require('../util/js_utils');

function Clazz() {}

Clazz.prototype.func = function() {
    return this;
};

Clazz.prototype.measure = function() {
    var self = this;
    var start = Date.now();
    var now = Date.now();
    var count = 0;
    while (true) {
        for (var i = 0; i < 100000; ++i) {
            if (self.func() !== self) {
                throw new Error('HUH');
            }
            count += 1;
        }
        process.stdout.write('.');
        now = Date.now();
        if (now - start > 5000) {
            process.stdout.write('\n');
            break;
        }
    }
    console.log('Calls per second', (count * 1000 / (now - start)).toFixed(1));
};

console.log('BIND');
var binded = new Clazz();
binded.func = binded.func.bind(binded);
binded.measure();

console.log('LODASH');
var lodasher = new Clazz();
_.bindAll(lodasher);
binded.measure();

console.log('CLOSURE');
var closure = new Clazz();
closure.func = function() {
    return Clazz.prototype.func.apply(closure, arguments);
};
closure.measure();

console.log('SELF BIND');
var selfbind = new Clazz();
js_utils.self_bind(selfbind);
selfbind.measure();
