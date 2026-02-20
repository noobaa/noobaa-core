/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mocha = require('mocha');
const stream = require('stream');
const crypto = require('crypto');
const Chance = require('chance');
const assert = require('assert');

const config = require('../../../../config');
const nb_native = require('../../../util/nb_native');
const RandStream = require('../../../util/rand_stream');
const ChunkCoder = require('../../../util/chunk_coder');
const ChunkEraser = require('../../../util/chunk_eraser');
const Speedometer = require('../../../util/speedometer');
const stream_utils = require('../../../util/stream_utils');
const FlattenStream = require('../../../util/flatten_stream');
const ChunkSplitter = require('../../../util/chunk_splitter');

const chance = new Chance();

const SP_A = 101;
const SP_D = 33;
const SP_I = 1024;

const CHUNK_SPLIT_CONFIGS = [
    { avg_chunk: SP_A, delta_chunk: SP_D, input: SP_I },
    { avg_chunk: SP_A, delta_chunk: 0, input: SP_I },
    // { avg_chunk: SP_A, delta_chunk: 0, input: SP_I },
    // { avg_chunk: SP_A, delta_chunk: 0, input: 0 },
];
const FRAG_SPECS = [
    { data_frags: 1, parity_frags: 0, parity_type: undefined, },
    //{ data_frags: 2, parity_frags: 2, parity_type: 'isa-c1', },
    //{ data_frags: 4, parity_frags: 2, parity_type: 'isa-c1', },
    //{ data_frags: 6, parity_frags: 2, parity_type: 'isa-c1', },
    //{ data_frags: 8, parity_frags: 4, parity_type: 'isa-c1', },
    { data_frags: 2, parity_frags: 2, parity_type: 'cm256', },
    { data_frags: 4, parity_frags: 2, parity_type: 'cm256', },
    { data_frags: 6, parity_frags: 2, parity_type: 'cm256', },
    { data_frags: 8, parity_frags: 4, parity_type: 'cm256', },
];
const DIGEST_TYPES = [
    'sha384',
    undefined,
];
const FRAG_DIGEST_TYPES = [
    'sha1',
    undefined,
];
const COMPRESS_TYPES = [
    'snappy',
    'zlib',
    undefined,
];
const CIPHER_TYPES = [
    'aes-256-gcm',
    // 'aes-256-ctr',
    // 'aes-256-cbc' is unsupported - requires complex padding
    // 'aes-256-ccm' is unsupported - requires specific EVP handling
    undefined,
];

const CHUNK_CODER_CONFIGS = [];
DIGEST_TYPES.forEach(digest_type =>
    FRAG_DIGEST_TYPES.forEach(frag_digest_type =>
        COMPRESS_TYPES.forEach(compress_type =>
            CIPHER_TYPES.forEach(cipher_type =>
                FRAG_SPECS.forEach(({ data_frags, parity_frags, parity_type }) =>
                    CHUNK_CODER_CONFIGS.push({
                        digest_type,
                        frag_digest_type,
                        compress_type,
                        cipher_type,
                        data_frags,
                        parity_frags,
                        parity_type,
                    }))))));


mocha.describe('nb_native chunk_coder', function() {
    this.timeout(10000); // eslint-disable-line no-invalid-this

    mocha.describe('streaming', function() {

        mocha.it('default-replicas-config', function() {
            return test_stream({
                erase: true,
                decode: true,
                generator: 'cipher',
                input_size: Math.floor(config.CHUNK_SPLIT_AVG_CHUNK * 7.3),
                chunk_split_config: {
                    avg_chunk: config.CHUNK_SPLIT_AVG_CHUNK,
                    delta_chunk: config.CHUNK_SPLIT_DELTA_CHUNK,
                },
                chunk_coder_config: {
                    digest_type: config.CHUNK_CODER_DIGEST_TYPE,
                    frag_digest_type: config.CHUNK_CODER_FRAG_DIGEST_TYPE,
                    compress_type: config.CHUNK_CODER_COMPRESS_TYPE,
                    cipher_type: config.CHUNK_CODER_CIPHER_TYPE,
                    data_frags: 1,
                    parity_frags: 0,
                }
            });
        });

        // TODO disabled this EC test temporarily
        mocha.it.skip('default-ec-config', function() {
            return test_stream({
                erase: true,
                decode: true,
                generator: 'cipher',
                input_size: Math.floor(config.CHUNK_SPLIT_AVG_CHUNK * 7.3),
                chunk_split_config: {
                    avg_chunk: config.CHUNK_SPLIT_AVG_CHUNK,
                    delta_chunk: config.CHUNK_SPLIT_DELTA_CHUNK,
                },
                chunk_coder_config: {
                    digest_type: config.CHUNK_CODER_DIGEST_TYPE,
                    frag_digest_type: config.CHUNK_CODER_FRAG_DIGEST_TYPE,
                    compress_type: config.CHUNK_CODER_COMPRESS_TYPE,
                    cipher_type: config.CHUNK_CODER_CIPHER_TYPE,
                    data_frags: config.CHUNK_CODER_EC_DATA_FRAGS,
                    parity_frags: config.CHUNK_CODER_EC_PARITY_FRAGS,
                    parity_type: config.CHUNK_CODER_EC_PARITY_TYPE,
                }
            });
        });

        CHUNK_CODER_CONFIGS.forEach(chunk_coder_config =>
            CHUNK_SPLIT_CONFIGS.forEach(chunk_split_config => {

                const desc = `/${chunk_coder_config.digest_type}` +
                    `/${chunk_coder_config.frag_digest_type}` +
                    `/${chunk_coder_config.compress_type}` +
                    `/${chunk_coder_config.cipher_type}` +
                    `/frags(${chunk_coder_config.data_frags}+${chunk_coder_config.parity_frags}-${chunk_coder_config.parity_type})` +
                    `/split(${chunk_split_config.input}%${chunk_split_config.avg_chunk}+-${chunk_split_config.delta_chunk})/`;

                mocha.it(desc, function() {
                    return test_stream({
                        erase: true,
                        decode: true,
                        generator: 'fake',
                        input_size: chunk_split_config.input,
                        chunk_split_config,
                        chunk_coder_config,
                    });
                });
            }));
    });

    mocha.describe('coding', function() {

        CHUNK_CODER_CONFIGS.forEach(chunk_coder_config => {
            const desc = `/${chunk_coder_config.digest_type}` +
                `/${chunk_coder_config.frag_digest_type}` +
                `/${chunk_coder_config.compress_type}` +
                `/${chunk_coder_config.cipher_type}/` +
                `frags(${chunk_coder_config.data_frags}+${chunk_coder_config.parity_frags}-${chunk_coder_config.parity_type})/`;

            mocha.describe(desc, function() {

                if (chunk_coder_config.digest_type && chunk_coder_config.frag_digest_type) {

                    mocha.it('detects-mismatch-frag-digest-with/out-enough-parity', function() {
                        const chunk = prepare_chunk(chunk_coder_config);
                        // corrupt up to parity_frags of the fragments - decode is still possible
                        chunk.frags = chance.shuffle(chunk.frags);
                        for (let i = 0; i < chunk_coder_config.parity_frags; ++i) {
                            const f = chunk.frags[i];
                            const b = f.data;
                            b.writeUInt8((b.readUInt8(0) + 1) % 256, 0);
                        }
                        call_chunk_coder_must_succeed('dec', chunk);

                        // corrupt another fragment - now decode should fail
                        for (let i = chunk_coder_config.parity_frags; i < chunk_coder_config.parity_frags + 1; ++i) {
                            const f = chunk.frags[i];
                            const b = f.data;
                            b.writeUInt8((b.readUInt8(0) + 1) % 256, 0);
                        }
                        call_chunk_coder_must_fail('dec', chunk);
                        assert(chunk.errors[0].startsWith('Chunk Decoder: missing data frags'),
                            'expected error: missing data frags. got: ' + chunk.errors[0]);
                    });
                }

                if (chunk_coder_config.digest_type) {
                    mocha.it('detects-mismatch-chunk-digest', function() {
                        const chunk = prepare_chunk(chunk_coder_config);
                        // corrupt all fragments, but fix the digest
                        chunk.frags = chance.shuffle(chunk.frags);
                        for (let i = 0; i < chunk.frags.length; ++i) {
                            const f = chunk.frags[i];
                            const b = f.data;
                            b.writeUInt8((b.readUInt8(0) + 1) % 256, 0);
                            if (chunk_coder_config.frag_digest_type) {
                                f.digest_b64 = crypto.createHash(chunk_coder_config.frag_digest_type).update(b).digest('base64');
                            }
                        }
                        call_chunk_coder_must_fail('dec', chunk);
                        if (!chunk_coder_config.compress_type) {
                            assert(chunk.errors[0].startsWith('Chunk Decoder: chunk digest mismatch') ||
                                chunk.errors[0].startsWith('Chunk Decoder: cipher decrypt final failed'),
                                'expected error: chunk digest mismatch. got: ' + chunk.errors[0]);
                        }
                    });
                }

                mocha.it('detects-mismatch-frag-size', function() {
                    const chunk = prepare_chunk(chunk_coder_config);
                    // change size of up to parity_frags of the fragments, but fix the digest
                    chunk.frags = chance.shuffle(chunk.frags);
                    for (let i = 0; i < chunk_coder_config.parity_frags; ++i) {
                        const f = chunk.frags[i];
                        f.data = f.data.slice(0, chance.integer({ min: 0, max: f.data.length - 1 }));
                        if (f.digest_type) {
                            f.digest_b64 = crypto.createHash(f.digest_type)
                                .update(f.data)
                                .digest('base64');
                        }
                    }
                    call_chunk_coder_must_succeed('dec', chunk);
                });

                mocha.it('encodes-consistent-parity-frags', function() {
                    const chunk = prepare_chunk(chunk_coder_config);
                    call_chunk_coder_must_succeed('dec', chunk);
                    const frags_by_index = _.keyBy(chunk.frags, _frag_index);
                    const max_parity_frags = 32;
                    for (let i = 0; i < max_parity_frags; ++i) {
                        const chunk_coder_config2 = _.defaults({ parity_frags: i, }, chunk_coder_config);
                        const chunk2 = prepare_chunk(chunk_coder_config2, chunk);
                        call_chunk_coder_must_succeed('dec', chunk2);
                        chunk2.frags.forEach(frag2 => {
                            const frag_index = _frag_index(frag2);
                            const frag = frags_by_index[frag_index];
                            if (frag) {
                                assert.strictEqual(frag2.digest_b64, frag.digest_b64);
                                assert.deepStrictEqual(frag2.data, frag.data);
                            } else {
                                assert(frag2.parity_index >= chunk_coder_config.parity_frags);
                            }
                        });
                    }
                });

            });
        });
    });
});

async function test_stream({ erase, decode, generator, input_size, chunk_split_config, chunk_coder_config }) {
    try {
        const speedometer = new Speedometer({ name: 'Chunk Coder Speed' });

        const input = new RandStream(input_size, {
            highWaterMark: 16 * 1024,
            generator,
        });

        const splitter = new ChunkSplitter({
            watermark: 100,
            calc_md5: true,
            calc_sha256: false,
            chunk_split_config,
        });

        const coder = new ChunkCoder({
            watermark: 20,
            concurrency: 20,
            coder: 'enc',
            chunk_coder_config,
        });

        const eraser = new ChunkEraser({
            watermark: 50,
        });

        const decoder = new ChunkCoder({
            watermark: 20,
            concurrency: 20,
            coder: 'dec',
        });

        let count = 0;
        let pos = 0;
        const reporter = new stream.Writable({
            objectMode: true,
            highWaterMark: 50,
            write(chunk, encoding, callback) {
                count += 1;
                // checking the position is continuous
                assert.strictEqual(pos, chunk.pos);
                pos += chunk.size;
                speedometer.update(chunk.size);
                callback();
            },
            final(callback) {
                speedometer.clear_interval();
                speedometer.summary();
                console.log('AVERAGE CHUNK SIZE', (pos / count).toFixed(0));
                callback();
            }
        });

        /** @type {(stream.Readable | stream.Transform | stream.Writable)[]} */
        const transforms = [input,
            splitter,
            coder,
        ];
        if (erase) transforms.push(eraser);
        if (decode) {
            transforms.push(decoder);
            transforms.push(new FlattenStream());
        }
        transforms.push(reporter);
        await stream_utils.pipeline(transforms);
    } catch (err) {
        throw_chunk_err(err);
    }
}

function call_chunk_coder_must_succeed(coder, chunk) {
    try {
        nb_native().chunk_coder(coder, chunk);
    } catch (err) {
        throw_chunk_err(err);
    }
    if (coder === 'dec') {
        assert.strictEqual(Buffer.compare(chunk.original, chunk.data), 0);
    }
}

function call_chunk_coder_must_fail(coder, chunk) {
    let err;
    try {
        nb_native().chunk_coder(coder, chunk);
    } catch (err1) {
        err = err1;
    }
    assert(err, 'chunk_coder must throw');
    assert.strictEqual(err.message, 'had chunk errors');
    assert(err.chunks, 'chunk_coder error must return chunks');
    assert.strictEqual(err.chunks.length, 1);
    assert.strictEqual(err.chunks[0], chunk);
    assert(chunk.errors && chunk.errors.length, 'chunk_coder errors missing for chunk');
}

function throw_chunk_err(err) {
    if (!err.chunks) throw err;
    let message = '';
    for (const chunk of err.chunks) {
        message += 'CHUNK ERRORS: ' + chunk.errors.join(',') + '\n';
    }
    throw new Error(err.message + '\n' + message);
}

function prepare_chunk(chunk_coder_config, copy_from_chunk) {
    const original = copy_from_chunk ? copy_from_chunk.original : crypto.randomBytes(SP_A);
    const data = Buffer.allocUnsafe(original.length);
    original.copy(data);

    const chunk = {
        data,
        original,
        size: data.length,
        chunk_coder_config,
    };

    if (copy_from_chunk) {
        chunk.cipher_key_b64 = copy_from_chunk.cipher_key_b64;
        // In case when we encode with defined key we need the relevant IV since it is non zero IV
        chunk.cipher_iv_b64 = copy_from_chunk.cipher_iv_b64 || Buffer.alloc(12).toString('base64');
    }

    call_chunk_coder_must_succeed('enc', chunk);

    assert.strictEqual(chunk.frags.length, chunk_coder_config.data_frags + chunk_coder_config.parity_frags);
    assert.strictEqual(chunk.errors, undefined);

    chunk.data = null;
    return chunk;
}

function _frag_index(frag) {
    if (frag.data_index >= 0) return `D${frag.data_index}`;
    if (frag.parity_index >= 0) return `P${frag.parity_index}`;
    if (frag.lrc_index >= 0) return `L${frag.lrc_index}`;
    throw new Error('BAD FRAG ' + JSON.stringify(frag));
}
