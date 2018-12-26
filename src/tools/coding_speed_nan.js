/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const argv = require('minimist')(process.argv);
const assert = require('assert');
const stream = require('stream');
const cluster = require('cluster');

const P = require('../util/promise');
const config = require('../../config');
const Pipeline = require('../util/pipeline');
const Speedometer = require('../util/speedometer');
const RandStream = require('../util/rand_stream');
const nb_native = require('../util/nb_native');
const dedup_options = require('../sdk/dedup_options');

argv.forks = argv.forks || 1;
argv.size = argv.size || 10240;

const master_speedometer = new Speedometer('Total Speed');
const speedometer = new Speedometer('Object Coding Speed');

if (argv.forks > 1 && cluster.isMaster) {
    master_speedometer.fork(argv.forks);
} else {
    main();
}

function main() {

    // setup coding
    const input = new RandStream(argv.size * 1024 * 1024, {
        highWaterMark: 16 * 1024,
    });
    const chunking_tpool = new(nb_native().ThreadPool)(1);
    const encode_tpool = new(nb_native().ThreadPool)(1);
    const decode_tpool = encode_tpool;
    const object_coding = new(nb_native().ObjectCoding)({
        digest_type: 'sha384',
        compress_type: 'snappy',
        cipher_type: 'aes-256-gcm',
        frag_digest_type: 'sha1',
        data_frags: 1,
        parity_frags: 0,
        lrc_frags: 0,
        lrc_parity: 0,
    });
    const chunker_config = new(nb_native().DedupConfig)(dedup_options);
    const chunker = new(nb_native().DedupChunker)({
        tpool: chunking_tpool
    }, chunker_config);
    let chunks_size_sum = 0;
    let chunks_count = 0;

    return new Pipeline(input)
        .pipe(new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform(chunk, encoding, callback) {
                this.bufs = this.bufs || [];
                this.bufs.push(chunk);
                this.bytes = (this.bytes || 0) + chunk.length;
                if (this.bytes > config.IO_STREAM_SPLIT_SIZE) {
                    if (argv.verbose) console.log('coalesce');
                    this.push(this.bufs);
                    this.bufs = [];
                    this.bytes = 0;
                }
                if (argv.fail1) return this.emit('error', new Error('FAIL1'));
                return callback();
            },
            flush(callback) {
                if (this.bytes) {
                    if (argv.verbose) console.log('coalesce flush');
                    this.push(this.bufs);
                    this.bufs = null;
                    this.bytes = 0;
                }
                if (argv.fail2) return this.emit('error', new Error('FAIL2'));
                return callback();
            }
        }))
        .pipe(new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform(input_buffers, encoding, callback) {
                if (argv.verbose) console.log('dedup');
                if (argv.fail3) return this.emit('error', new Error('FAIL3'));
                chunker.push(input_buffers, (err, buffers) => {
                    if (err) return this.emit('error', err);
                    return callback(null, buffers);
                });
            },
            flush(callback) {
                if (argv.fail4) return this.emit('error', new Error('FAIL4'));
                chunker.flush((err, buffers) => {
                    if (err) return this.emit('error', err);
                    return callback(null, buffers);
                });
            }
        }))
        .pipe(new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform(buffers, encoding, callback) {
                if (argv.verbose) console.log('encode');
                if (argv.fail5) return this.emit('error', new Error('FAIL5'));
                P.map(buffers, buf => P.fromCallback(
                        cb => object_coding.encode(encode_tpool, buf, cb)
                    ))
                    .tap(then => assert(!argv.fail1, 'FAIL1'))
                    .then(chunks => callback(null, chunks))
                    .catch(err => this.emit('error', err));
            }
        }))
        .pipe(new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform(chunks, encoding, callback) {
                if (argv.verbose) console.log('decode');
                if (argv.fail6) return this.emit('error', new Error('FAIL6'));
                P.map(chunks, buf => (argv.decode ? P.fromCallback(
                        cb => object_coding.decode(decode_tpool, buf, cb)
                    ) : buf), {
                        concurrency: 1
                    })
                    .then(res_chunks => callback(null, res_chunks))
                    .catch(err => this.emit('error', err));
            }
        }))
        .pipe(new stream.Transform({
            objectMode: true,
            allowHalfOpen: false,
            highWaterMark: 1,
            transform(chunks, encoding, callback) {
                if (argv.verbose) console.log('end');
                if (argv.fail7) return this.emit('error', new Error('FAIL7'));
                for (const chunk of chunks) {
                    // console.log('done', chunk);
                    const size = chunk.size || chunk.length || 0;
                    // const compressed_size = chunk.compressed_size || 0;
                    chunks_size_sum += size;
                    chunks_count += 1;
                    speedometer.update(size);
                }
                callback();
            }
        }))
        .promise()
        .then(() => {
            console.log('AVERAGE CHUNK SIZE', (chunks_size_sum / chunks_count).toFixed(0));
            process.exit();
        })
        .catch(err => {
            console.error('CODING ERROR', err.stack || err);
            // this delay helps to test that with '--fail? --verbose' we really stop all streams on error
            // return P.delay(1000);
            process.exit();
        });
}
