/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../../util/promise');
const mocha = require('mocha');
// var assert = require('assert');
const Prefetch = require('../../../util/prefetch');

function log(...args) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(...args);
}


mocha.describe('prefetch', function() {

    mocha.it('should work', async function() {
        let id = 0;
        const pr = new Prefetch({
            low_length: 30,
            high_length: 32,
            load: async count => {
                const n = count;
                log('... LOAD', n, '(' + count + ')', 'length', pr.length);
                await P.delay(5);
                log('>>> LOAD', n, '(' + count + ')', 'length', pr.length);
                return _.times(n, () => {
                    id += 1;
                    return id;
                });
            }
        });
        await P.delay(10);
        log('A - length', pr.length);
        for (let i = 0; i < 10; ++i) {
            await P.delay(0);
            const res = await pr.fetch(2);
            log('A - fetch', res, 'length', pr.length);
        }
        await P.delay(10);
        log('B - length', pr.length);
        await Promise.all(_.times(10, async () => {
            const res = await pr.fetch(2);
            log('B - fetch', res, 'length', pr.length);
        }));
        await P.delay(10);
        log('length', pr.length);
    });

});
