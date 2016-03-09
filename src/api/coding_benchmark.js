'use strict';

require('../util/panic');
var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var chance = require('chance')();
var time_utils = require('../util/time_utils');
var transformer = require('../util/transformer');
var Pipeline = require('../util/pipeline');
var dbg = require('../util/debug_module')(__filename);
dbg.set_level(5, 'core');

if (require.main === module) {
    test();
}

function test() {
    var filename = process.argv[2];
    var mode = process.argv[3];
    console.log('FILE', filename);
    var input;
    if (parseInt(filename, 10)) {
        var RandStream = require('../util/rand_stream');
        input = new RandStream(parseInt(filename, 10), {
            highWaterMark: 1024 * 1024
        });
    } else {
        input = fs.createReadStream(filename, {
            highWaterMark: 1024 * 1024
        });
    }
    var client;
    var stats = {
        count: 0,
        bytes: 0,
        compress_bytes: 0,
        last_bytes: 0,
        start: Date.now(),
        last_start: Date.now(),
    };
    var progress = function(size, compress_size) {
        process.stdout.write('.');
        // process.stdout.write(size + '.');
        stats.count += 1;
        stats.bytes += size;
        stats.compress_bytes += compress_size;
        if (stats.count % 60 === 0) {
            var now = Date.now();
            var mb_per_sec = (stats.bytes - stats.last_bytes) *
                1000 / (now - stats.last_start) / 1024 / 1024;
            process.stdout.write(' ' + mb_per_sec.toFixed(1) + ' MB/s\n');
            stats.last_bytes = stats.bytes;
            stats.last_start = now;
        }
    };
    var fin = function(err) {
        if (err) {
            console.error('ERROR', err.stack || err);
        }
        process.stdout.write('\n\n');
        var mb_per_sec = stats.bytes * 1000 / (Date.now() - stats.start) / 1024 / 1024;
        console.log('DONE.', stats.count, 'chunks.',
            'average speed', mb_per_sec.toFixed(1), 'MB/s',
            'average chunk size', (stats.bytes / stats.count).toFixed(1),
            'compression ratio', (100 * stats.compress_bytes / stats.bytes).toFixed(1) + '%');
        process.exit();
    };
    var fin_exit = function() {
        try {
            fin();
        } catch (err) {
            console.error(err.stack || err);
        }
        process.abort();
    };
    process.on('SIGTERM', fin_exit);
    process.on('SIGINT', fin_exit);


    if (mode === '1') {
        test_coding();
    } else if (mode === '2') {
        test_allocate_parts();
    } else if (mode === '3') {
        test_write_block();
    } else if (mode === '4') {
        test_legacy_js_coding();
    } else {
        test_upload();
    }

    function init_api() {
        var api = require('../api');
        var rpc = api.new_rpc();
        client = rpc.new_client();
        rpc.register_n2n_transport(client.node.n2n_signal);
        return client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo',
            system: 'demo',
        });
    }

    function test_upload() {
        init_api()
            .then(function() {
                return client.object.delete_object({
                    bucket: 'files',
                    key: path.basename(filename),
                }).fail(function() {});
            })
            .then(function() {
                return client.object_driver_lazy().upload_stream({
                    bucket: 'files',
                    key: path.basename(filename),
                    size: fs.statSync(filename).size,
                    content_type: require('mime').lookup(filename),
                    source_stream: input
                });
            })
            .done(fin, fin);
    }

    function test_coding() {
        var CoalesceStream = require("../util/coalesce_stream");
        var native_core = require("../util/native_core")();
        var dedup_options = require("../api/dedup_options");
        var dedup_chunker = new native_core.DedupChunker({
            tpool: new native_core.ThreadPool(1)
        }, new native_core.DedupConfig(dedup_options));
        var object_coding_tpool = new native_core.ThreadPool(2);
        var object_coding = new native_core.ObjectCoding({
            digest_type: 'sha384',
            compress_type: 'snappy',
            cipher_type: 'aes-256-gcm',
            frag_digest_type: 'sha1',
            data_frags: 1,
            parity_frags: 0,
            lrc_frags: 0,
            lrc_parity: 0,
        });
        var pipeline = new Pipeline(input);
        pipeline.pipe(new CoalesceStream({
            highWaterMark: 10,
            max_length: 10,
            max_wait_ms: 100,
            objectMode: true
        }));
        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                objectMode: true,
            },
            transform: (t, data) => P.ninvoke(dedup_chunker, 'push', data),
            flush: t => P.ninvoke(dedup_chunker, 'flush')
        }));
        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                flatten: true,
                objectMode: true,
            },
            transform_parallel: (t, data) => {
                // console.log('encode chunk');
                return P.ninvoke(object_coding, 'encode', object_coding_tpool, data);
            },
        }));
        if (process.argv[4]) {
            pipeline.pipe(new CoalesceStream({
                highWaterMark: 4,
                max_length: 10,
                max_wait_ms: 100,
                objectMode: true,
            }));
            pipeline.pipe(transformer({
                options: {
                    highWaterMark: 4,
                    flatten: true,
                    objectMode: true,
                },
                transform_parallel: (t, chunk) => {
                    return P.ninvoke(object_coding, 'decode', object_coding_tpool, chunk)
                        .thenResolve(chunk);
                },
            }));
        }
        pipeline.pipe(transformer({
            options: {
                highWaterMark: 4,
                flatten: true,
                objectMode: true,
            },
            transform: (t, chunk) => {
                // console.log('done', chunk);
                progress(chunk.size || chunk.length || 0, chunk.compress_size || 0);
            },
        }));
        pipeline.run().done(fin, fin);
    }

    function test_allocate_parts() {
        var concur = parseInt(process.argv[4]);
        concur = _.isNaN(concur) ? 1 : concur;
        var nparts = parseInt(process.argv[5]);
        nparts = _.isNaN(nparts) ? 1 : nparts;
        console.log('CONCUR', concur, 'NPARTS', nparts);
        init_api()
            .then(function() {
                return client.object.delete_object({
                    bucket: 'files',
                    key: path.basename(filename),
                }).fail(function() {});
            })
            .then(function() {
                return client.object.create_multipart_upload({
                    bucket: 'files',
                    key: path.basename(filename),
                    size: 1024 * 1024 * 1024 * 1024,
                    content_type: 'application/octet_stream'
                });
            })
            .then(function() {
                var req_count = 0;
                var part_count = 0;
                var total_start_time = time_utils.millistamp();
                var last_print_time = 0;
                var req_took_ms_sum = 0;

                function report(total_took_sec) {
                    console.log("benchmarking allocate_object_parts - ", (req_count / total_took_sec).toFixed(1),
                        "requests per sec", (part_count / total_took_sec).toFixed(1),
                        "parts per sec", (req_took_ms_sum / req_count).toFixed(1),
                        "ms/req", (req_took_ms_sum / part_count).toFixed(1), "ms/part");
                }
                var i = 0;
                return P.all(_.times(concur, function loop() {
                        var req_start_time = time_utils.millistamp();
                        return client.object.allocate_object_parts({
                            bucket: 'files',
                            key: path.basename(filename),
                            parts: _.times(nparts, function() {
                                var p = {
                                    'start': i * 1024 * 1024,
                                    'end': (i + 1) * 1024 * 1024,
                                    'upload_part_number': 0,
                                    'part_sequence_number': i
                                };
                                p.chunk = {
                                    'size': 1024 * 1024,
                                    'digest_type': 'sha384',
                                    'compress_type': 'snappy',
                                    'compress_size': 1024 * 1024,
                                    'cipher_type': 'aes-256-gcm',
                                    'data_frags': 1,
                                    'lrc_frags': 0,
                                    'digest_b64': chance.string({
                                        length: 48
                                    }),
                                    'cipher_key_b64': chance.string({
                                        length: 32
                                    }),
                                };
                                p.frags = _.times(1, function(j) {
                                    return {
                                        'size': 1024 * 1024,
                                        'layer': 'D',
                                        'layer_n': 0,
                                        'frag': j,
                                        'digest_type': 'sha1',
                                        'digest_b64': chance.string({
                                            length: 20
                                        })
                                    };
                                });
                                i += 1;
                                return p;
                            })
                        }).then(function() {
                            req_count += 1;
                            part_count += nparts;
                            var millistamp = time_utils.millistamp();
                            req_took_ms_sum += millistamp - req_start_time;
                            var total_took_sec = (millistamp - total_start_time) / 1000;
                            if (total_took_sec > last_print_time + 1) {
                                last_print_time = total_took_sec;
                                report(total_took_sec);
                            }
                            if (true || total_took_sec < 10) {
                                return loop();
                            }
                        });
                    }))
                    .then(function() {
                        var total_took_sec = time_utils.secstamp() - total_start_time;
                        report(total_took_sec);
                    });
            })
            .done(fin, fin);
    }

    function test_write_block() {
        var concur = parseInt(process.argv[4]);
        concur = _.isNaN(concur) ? 1 : concur;
        var write_bytes = 300000;
        init_api()
            .then(function() {
                return client.node.list_nodes({});
            })
            .then(function(res) {
                var nodes = res.nodes;
                console.log('NODES ADDRESSES', _.map(nodes, 'rpc_address'));
                var next_node_rr = 0;
                var req_count = 0;
                var bytes_count = 0;
                var total_start_time = time_utils.millistamp();
                var last_print_time = 0;
                var req_took_ms_sum = 0;
                var data = crypto.randomBytes(write_bytes);
                var digest_type = 'sha1';
                var digest_b64 = crypto.createHash(digest_type).update(data).digest('base64');

                function report(total_took_sec) {
                    var mb_count = bytes_count / 1024 / 1024;
                    console.log("benchmarking allocate_object_parts - ", (req_count / total_took_sec).toFixed(1),
                        "requests per sec", (mb_count / total_took_sec).toFixed(1),
                        "MB/s", (req_took_ms_sum / req_count).toFixed(1),
                        "ms/req", (req_took_ms_sum / mb_count).toFixed(1), "ms/MB");
                }
                return P.all(_.times(concur, function loop(i) {
                        var req_start_time = time_utils.millistamp();
                        var next_node = nodes[next_node_rr];
                        next_node_rr = (next_node_rr + 1) % nodes.length;
                        return client.agent.write_block({
                            block_md: {
                                id: '' + Math.random(),
                                address: next_node.rpc_address,
                                digest_type: digest_type,
                                digest_b64: digest_b64
                            },
                            data: data
                        }, {
                            address: next_node.rpc_address,
                        }).then(function() {
                            req_count += 1;
                            bytes_count += write_bytes;
                            var millistamp = time_utils.millistamp();
                            req_took_ms_sum += millistamp - req_start_time;
                            var total_took_sec = (millistamp - total_start_time) / 1000;
                            if (total_took_sec > last_print_time + 1) {
                                last_print_time = total_took_sec;
                                report(total_took_sec);
                            }
                            if (true || total_took_sec < 10) {
                                return loop();
                            }
                        });
                    }))
                    .then(function() {
                        var total_took_sec = time_utils.secstamp() - total_start_time;
                        report(total_took_sec);
                    });
            })
            .done(fin, fin);
    }

    function test_legacy_js_coding() {
        // for comparison this is the old javascript impl
        var rabin = require('../../attic/rabin');
        var Poly = require('../../attic/poly');
        var chunk_crypto = require('../../attic/chunk_crypto');
        var pipeline = new Pipeline(input);
        pipeline.pipe(new rabin.RabinChunkStream({
            window_length: 64,
            min_chunk_size: 3 * 128 * 1024,
            max_chunk_size: 6 * 128 * 1024,
            hash_spaces: [{
                poly: new Poly(Poly.PRIMITIVES[31]),
                hash_bits: 18, // 256 KB average chunk
                hash_val: 0x07071070 // hebrew calculator pimp
            }],
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 5
            },
            transform: (t, data) => {
                var crypt_info = {
                    hash_type: 'sha384',
                    cipher_type: 'aes-256-gcm'
                };
                return chunk_crypto.encrypt_chunk(data, crypt_info);
            }
        }));
        pipeline.pipe(transformer({
            options: {
                objectMode: true,
                highWaterMark: 1
            },
            transform: (t, chunk) => {
                // console.log('done', chunk);
                progress(chunk.size || chunk.length || 0, chunk.compress_size || 0);
            },
        }));
        pipeline.run().done(fin, fin);
    }

}
