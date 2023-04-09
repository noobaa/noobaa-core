/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const js_utils = require('../util/js_utils');

function Clazz() { /* Clazz? */ }

Clazz.prototype.func = function() {
    return this;
};

Clazz.prototype.measure = function() {
    const self = this;
    const start = Date.now();
    let now = Date.now();
    let count = 0;
    let run = true;
    while (run) {
        for (let i = 0; i < 100000; ++i) {
            if (self.func() !== self) {
                throw new Error('HUH');
            }
            count += 1;
        }
        process.stdout.write('.');
        now = Date.now();
        if (now - start > 2000) {
            process.stdout.write('\n');
            run = false;
        }
    }
    console.log('Calls per second', (count * 1000 / (now - start)).toFixed(1));
};

console.log('\nBIND');
const binded = new Clazz();
binded.func = binded.func.bind(binded);
binded.measure();

console.log('\nLODASH (_.bindAll)');
const lodasher = new Clazz();
_.bindAll(lodasher);
binded.measure();

console.log('\nCLOSURE');
const closure = new Clazz();
closure.func = function() {
    return Clazz.prototype.func.apply(closure, arguments);
};
closure.measure();

console.log('\nSELF BIND (js_utils.self_bind)');
const selfbind = new Clazz();
js_utils.self_bind(selfbind);
selfbind.measure();
