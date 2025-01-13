/* Copyright (C) 2016 NooBaa */
'use strict';

require('../util/fips');

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const stream = require('stream');
const assert = require('assert');
const crypto = require('crypto');

const config = require('../../config');
const ChunkCoder = require('../util/chunk_coder');
const RandStream = require('../util/rand_stream');
const Speedometer = require('../util/speedometer');
const ChunkEraser = require('../util/chunk_eraser');
const ChunkSplitter = require('../util/chunk_splitter');
const FlattenStream = require('../util/flatten_stream');
// const CoalesceStream = require('../util/coalesce_stream');

require('../util/console_wrapper').original_console();

argv.forks = argv.forks || 1;
argv.size = argv.size || 10240;
argv.encode = (argv.encode !== false); // default is true, use --no-encode for false
argv.decode = Boolean(argv.encode && argv.decode); // default is false, use --decode
argv.erase = Boolean(argv.decode && (argv.erase !== false)); // default is true (if decode), use --no-erase for false
argv.ec = Boolean(argv.ec); // default is false, use --ec
argv.md5 = Boolean(argv.md5); // default is false, use --md5
argv.sha256 = Boolean(argv.sha256); // default is false
argv.compare = Boolean(argv.compare); // default is false
argv.verbose = Boolean(argv.verbose); // default is false
argv.sse_c = Boolean(argv.sse_c); // default is false
delete argv._;

const speedometer = new Speedometer({
    name: 'Chunk Coder Speed',
    argv,
    num_workers: argv.forks,
    workers_func,
});
speedometer.start();

async function workers_func() {

    const chunk_split_config = {
        avg_chunk: config.CHUNK_SPLIT_AVG_CHUNK,
        delta_chunk: config.CHUNK_SPLIT_DELTA_CHUNK,
    };

    const chunk_coder_config = _.omitBy({
        digest_type: config.CHUNK_CODER_DIGEST_TYPE,
        frag_digest_type: config.CHUNK_CODER_FRAG_DIGEST_TYPE,
        compress_type: config.CHUNK_CODER_COMPRESS_TYPE,
        cipher_type: config.CHUNK_CODER_CIPHER_TYPE,
        data_frags: 1,
        ...(argv.ec ? {
            data_frags: config.CHUNK_CODER_EC_DATA_FRAGS,
            parity_frags: config.CHUNK_CODER_EC_PARITY_FRAGS,
            parity_type: config.CHUNK_CODER_EC_PARITY_TYPE,
        } : null)
    }, val => val === undefined || val === 'none');

    const cipher_key_b64 = argv.sse_c ? crypto.randomBytes(32).toString('base64') : undefined;

    console.log('chunk_split_config', chunk_split_config);
    console.log('chunk_coder_config', chunk_coder_config);
    console.log('cipher_key_b64', cipher_key_b64);

    const input = new RandStream(argv.size * 1024 * 1024, {
        highWaterMark: 16 * 1024,
        generator: argv.generator,
    });

    const splitter = new ChunkSplitter({
        watermark: 100,
        calc_md5: argv.md5,
        calc_sha256: argv.sha256,
        chunk_split_config,
    });

    const coder = new ChunkCoder({
        watermark: 20,
        concurrency: 20,
        coder: 'enc',
        chunk_coder_config,
        cipher_key_b64,
    });

    const decoder = new ChunkCoder({
        watermark: 20,
        concurrency: 20,
        coder: 'dec',
        cipher_key_b64,
    });

    const eraser = new ChunkEraser({
        watermark: 50,
        save_data: 'original_data',
        verbose: argv.verbose,
    });

    let total_size = 0;
    let num_parts = 0;
    const reporter = new stream.Writable({
        objectMode: true,
        highWaterMark: 50,
        write(chunk, encoding, callback) {
            if (argv.verbose) console.log({ ...chunk, data: 'ommitted' });
            if (argv.compare && chunk.original_data) {
                assert(Buffer.concat(chunk.original_data).equals(chunk.data));
            }
            total_size += chunk.size;
            num_parts += 1;
            speedometer.update(chunk.size);
            callback();
        }
    });

    /** @type {(stream.Readable | stream.Transform | stream.Writable)[]} */
    const transforms = [
        input,
        splitter,
    ];
    if (argv.encode) {
        transforms.push(coder);
        transforms.push(new FlattenStream());
    }
    if (argv.erase) transforms.push(eraser);
    if (argv.decode) {
        transforms.push(decoder);
        transforms.push(new FlattenStream());
    }
    transforms.push(reporter);

    try {
        await stream.promises.pipeline(transforms);
        console.log('AVERAGE CHUNK SIZE', (total_size / num_parts).toFixed(0));
        if (splitter.md5) {
            console.log('MD5 =', splitter.md5.toString('base64'));
        }
        if (splitter.sha256) {
            console.log('SHA256 =', splitter.sha256.toString('base64'));
        }
    } catch (err) {
        if (!err.chunks) throw err;
        let message = '';
        for (const chunk of err.chunks) {
            message += 'CHUNK ERRORS: ' + chunk.errors.join(',') + '\n';
        }
        throw new Error(err.message + '\n' + message);
    }
}
