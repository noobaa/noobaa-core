/* Copyright (C) 2016 NooBaa */
/*eslint max-lines-per-function: ["error", 550]*/
'use strict';

const mocha = require('mocha');
const assert = require('assert');
const RangeStream = require('../../util/range_stream');

mocha.describe('range_stream', function() {

    mocha.it('range in the second buffer of two buffers', async function() {
        const bufs = await _range_stream(8, 10, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([19, 20]),
        ]);
    });

    mocha.it('range in the first buffer', async function() {
        const bufs = await _range_stream(1, 5, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21])
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([12, 13, 14, 15]),
        ]);
    });

    mocha.it('range has one byte', async function() {
        const bufs = await _range_stream(0, 1, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([11]),
        ]);
    });

    mocha.it('range is entire buffer', async function() {
        const bufs = await _range_stream(6, 11, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([17, 18, 19, 20, 21]),
        ]);
    });

    mocha.it('range across two buffers', async function() {
        const bufs = await _range_stream(2, 9, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([13, 14, 15, 16]),
            Buffer.from([17, 18, 19]),
        ]);
    });

    mocha.it('range starts from the first buffer and is larger than buffers', async function() {
        const bufs = await _range_stream(2, 100, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
        ]);
    });

    mocha.it('range starts from the second buffer and is larger than buffers', async function() {
        const bufs = await _range_stream(8, 100, [
            Buffer.from([11, 12, 13, 14, 15, 16]),
            Buffer.from([17, 18, 19, 20, 21]),
            []
        ]);

        assert.deepStrictEqual(bufs, [
            Buffer.from([19, 20, 21]),
        ]);
    });
});

function _range_stream(start, end, in_bufs) {
    return new Promise((resolve, reject) => {
        let bufs = [];
        let stm = new RangeStream(start, end);
        stm.on('data', data => bufs.push(data));
        stm.on('error', reject);
        stm.on('end', () => resolve(bufs));
        for (const buf of in_bufs) {
            if (buf.length === 0) {
                stm.end();
                break;
            }
            stm.write(buf);
        }
    });
}
