'use strict';

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const cluster = require('cluster');

const P = require('../util/promise');
const Pipeline = require('../util/pipeline');
const js_utils = require('../util/js_utils');
const Speedometer = require('../util/speedometer');
const transformer = require('../util/transformer');
const RandStream = require('../util/rand_stream');
const ChunkStream = require('../util/chunk_stream');
const native_core = require('../util/native_core')();
const dedup_options = require('../api/dedup_options');

argv.forks = argv.forks || 1;
argv.size = argv.size || 1024;

if (argv.forks > 1 && cluster.isMaster) {
    let master_speedometer = new Speedometer('Total Speed');
    master_speedometer.enable_cluster();
    for (let i = 0; i < argv.forks; i++) {
        let worker = cluster.fork();
        console.warn('Worker start', worker.process.pid);
    }
    cluster.on('exit', function(worker, code, signal) {
        console.warn('Worker exit', worker.process.pid);
        if (_.isEmpty(cluster.workers)) {
            process.exit();
        }
    });
} else {
    main();
}

function main() {

    // setup coding
    let input = new RandStream(argv.size * 1024 * 1024, {
        highWaterMark: 8 * 1024 * 1024,
    });
    let chunking_tpool = new native_core.ThreadPool(1);
    let encode_tpool = new native_core.ThreadPool(2);
    let decode_tpool = encode_tpool;
    let object_coding = new native_core.ObjectCoding({
        digest_type: 'sha384',
        compress_type: 'snappy',
        cipher_type: 'aes-256-gcm',
        frag_digest_type: 'sha1',
        data_frags: 1,
        parity_frags: 0,
        lrc_frags: 0,
        lrc_parity: 0,
    });
    let chunker_config = new native_core.DedupConfig(dedup_options);
    let chunker = new native_core.DedupChunker({
        tpool: chunking_tpool
    }, chunker_config);
    let chunks_size_sum = 0;
    let chunks_count = 0;

    let speedometer = new Speedometer('Object Coding Speed');
    speedometer.enable_cluster();

    let pipeline = new Pipeline(input);
    pipeline.pipe(new ChunkStream(128 * 1024 * 1024, {
        highWaterMark: 1,
        objectMode: true
    }));
    pipeline.pipe(transformer({
        options: {
            highWaterMark: 1,
            objectMode: true,
        },
        transform: (t, data) => {
            return P.fcall(() => P.ninvoke(chunker, 'push', data))
                .then(buffers => P.ninvoke(chunker, 'flush')
                    .then(last_bufs => js_utils.array_push_all(buffers, last_bufs)))
                .then(buffers => P.map(buffers,
                    buffer => P.ninvoke(object_coding, 'encode', encode_tpool, buffer)));
        },
    }));
    if (argv.decode) {
        pipeline.pipe(transformer({
            options: {
                highWaterMark: 1,
                objectMode: true,
            },
            transform_parallel: (t, chunks) => {
                return P.ninvoke(object_coding, 'decode', decode_tpool, chunks);
            },
        }));
    }
    pipeline.pipe(transformer({
        options: {
            highWaterMark: 1,
            flatten: true,
            objectMode: true,
        },
        transform: (t, chunk) => {
            // console.log('done', chunk);
            let size = chunk.size || chunk.length || 0;
            // let compressed_size = chunk.compressed_size || 0;
            chunks_size_sum += size;
            chunks_count += 1;
            speedometer.update(size);
        },
    }));
    pipeline.run().then(() => {
        console.log('AVERAGE CHUNK SIZE', (chunks_size_sum / chunks_count).toFixed(0));
        process.exit();
    });
}
