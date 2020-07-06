/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
// const util = require('util');
const mocha = require('mocha');
const assert = require('assert');
const crypto = require('crypto');
const sort_utils = require('../../util/sort_utils');

// const inspect = (x, max_arr = 5) => util.inspect(x, { colors: true, depth: null, maxArrayLength: max_arr, sorted: true });

mocha.describe('sort_utils', function() {

    mocha.it(`compare_by_key(String)`, function() {
        const arr = _.shuffle(_.times(100, i => Math.floor(100 * Math.random())));
        const a = arr.slice().sort(sort_utils.compare_by_key(String));
        const b = _.sortBy(arr, String);
        assert.strict.deepEqual(a, b);
    });

    mocha.it(`compare_by_key(it => it.x)`, function() {
        const key_getter = it => it.x;
        const arr = _.shuffle(_.times(100, i => Math.floor(100 * Math.random())).map(x => ({ x })));
        const a = arr.slice().sort(sort_utils.compare_by_key(key_getter));
        const b = _.sortBy(arr, key_getter);
        assert.strict.deepEqual(a, b);
    });

    mocha.describe('SortedLimit*', function() {

        const ctors = [
            sort_utils.SortedLimitEveryPush,
            sort_utils.SortedLimitEveryBatch,
            sort_utils.SortedLimitSplice,
            sort_utils.SortedLimitShift,
        ];

        function test_all(limit, count, prefix = 'prefix-long-enough/and-sub-dir/') {
            mocha.it(`limit=${limit} count=${count}`, function() {
                const impls = ctors.map(Ctor => new Ctor(limit));
                const gen = crypto.createCipheriv('aes-128-gcm', crypto.randomBytes(16), crypto.randomBytes(12));
                for (let j = 0; j < count; ++j) {
                    const val = prefix + gen.update(Buffer.alloc(8)).toString('base64');
                    for (const impl of impls) impl.push(val);
                }
                let results;
                for (const impl of impls) {
                    const r = impl.end();
                    console.log(`limit=${limit} count=${count} ctor=${impl.constructor.name} last=${r[r.length - 1]}`);
                    if (results) {
                        assert.strict.deepEqual(r, results);
                    } else {
                        results = r;
                    }
                }
            });
        }

        test_all(1, 0);
        test_all(1, 1);
        test_all(1, 2);
        test_all(1, 10);
        test_all(1, 100);

        test_all(2, 0);
        test_all(2, 1);
        test_all(2, 2);
        test_all(2, 10);

        test_all(1000, 1000);
        test_all(1000, 2000);
        test_all(1000, 10000);
    });

});
