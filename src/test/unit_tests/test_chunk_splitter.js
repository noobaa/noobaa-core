/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const crypto = require('crypto');
const assert = require('assert');

const P = require('../../util/promise');
const RandStream = require('../../util/rand_stream');
const ChunkSplitter = require('../../util/chunk_splitter');

function log(msg) {
    if (process.env.SUPPRESS_LOGS) return;
    console.log(msg);
}

mocha.describe('ChunkSplitter', function() {

    mocha.it('is consistent', function() {
        this.timeout(100000); // eslint-disable-line no-invalid-this
        const options = {
            avg_chunk: 4503,
            delta_chunk: 1231,
            len: 1517203,
            cipher_seed: Buffer.from('ChunkSplitter is consistent!'),
        };
        return P.all(_.times(30, i => split_stream(options)))
            .then(res => {
                const points = res[0];
                for (let i = 1; i < res.length; ++i) {
                    const points2 = res[i];
                    assert.deepStrictEqual(points, points2);
                }
            });
    });

    mocha.it.skip('splits almost the same when pushing bytes at the start', function() {
        const avg_chunk = 1000;
        const delta_chunk = 500;
        // random buffer from fixed seed
        const buf = crypto.createCipheriv('aes-128-gcm',
                Buffer.from('1234567890123456'),
                Buffer.from('123456789012'))
            .update(Buffer.alloc(5000));
        const bufs = [
            buf,
            Buffer.concat([crypto.randomBytes(1), buf]),
            Buffer.concat([crypto.randomBytes(2), buf]),
            Buffer.concat([crypto.randomBytes(3), buf]),
            Buffer.concat([crypto.randomBytes(4), buf]),
        ];
        return P.map(bufs, data => split_buffer({ avg_chunk, delta_chunk, data }))
            .then(res => {
                res.forEach(p => log(p));
                // remove the first and last points from the comparison
                const points = res[0].slice(1, -1);
                for (let i = 1; i < res.length; ++i) {
                    const points2 = res[i];
                    let found = false;
                    for (let j = 0; j <= points2.length - points.length; ++j) {
                        if (_.isEqual(points, points2.slice(j, j + points.length))) {
                            found = true;
                            break;
                        }
                    }
                    assert(found, `points ${points.join(',')} not found in ${points2.join(',')}`);
                }
            });
    });

    function split_stream({ avg_chunk, delta_chunk, len, cipher_seed }) {
        return new Promise((resolve, reject) => {
            const points = [];
            const input = new RandStream(len, { cipher_seed });
            const splitter = new ChunkSplitter({
                watermark: 100,
                calc_md5: true,
                calc_sha256: false,
                chunk_split_config: { avg_chunk, delta_chunk }
            });
            input.once('error', reject);
            splitter.once('error', reject);
            splitter.once('end', () => resolve(points));
            splitter.on('data', chunk => points.push(chunk.size));
            input.pipe(splitter);
        });
    }

    function split_buffer({ avg_chunk, delta_chunk, data }) {
        return new Promise((resolve, reject) => {
            const points = [];
            const splitter = new ChunkSplitter({
                watermark: 100,
                calc_md5: true,
                calc_sha256: false,
                chunk_split_config: { avg_chunk, delta_chunk }
            });
            splitter.once('error', reject);
            splitter.once('end', () => resolve(points));
            splitter.on('data', chunk => points.push(chunk.size));
            splitter.end(data);
        });
    }

});
