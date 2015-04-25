'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var argv = require('minimist')(process.argv);
var RPC = require('./rpc');
var RpcSchema = require('./rpc_schema');
var rpc_http = require('./rpc_http');
var rpc_ws = require('./rpc_ws');
var memwatch = require('memwatch');
var dbg = require('noobaa-util/debug_module')(__filename);
var MB = 1024 * 1024;

// test arguments
// time to run in seconds
argv.time = argv.time || undefined;
// io concurrency
argv.concur = argv.concur || 1;
// io size in bytes
argv.size = argv.size || MB;
// proto, host and port to use
argv.proto = argv.proto || 'ws';
argv.host = argv.host || '127.0.0.1';
argv.port = argv.port || 5656;
// client mode
argv.client = argv.client || false;
// server mode
argv.server = argv.server || false;
if (!argv.client && !argv.server) {
    argv.client = argv.server = true;
}
// debug level
argv.debug = argv.debug || 0;
// profiling tools
if (argv.look) {
    require('look').start();
}
if (argv.leak) {
    memwatch.on('leak', function(info) {
        dbg.warn('LEAK', info);
    });
}
var heapdiff;
argv.heap = argv.heap || false;

dbg.log('Arguments', argv);
dbg.set_level(argv.debug, __dirname);

var schema = new RpcSchema();
schema.register_api({
    name: 'bench',
    methods: {
        io: {
            method: 'POST',
            params: {
                type: 'object',
                properties: {
                    kushkush: {
                        type: 'object',
                        required: ['data'],
                        properties: {
                            data: {
                                type: 'buffer'
                            }
                        }
                    }
                }
            },
            reply: {
                type: 'object',
                properties: {
                    data: {
                        type: 'buffer'
                    }
                }
            }
        }
    }
});

// create rpc
var rpc = new RPC();

// create rpc client
var bench_client = rpc.create_client(schema.bench);

var buffer = new Buffer(argv.size);
var io_count = 0;
var io_bytes = 0;
var start_time = Date.now();
var report_time = start_time;
var report_io_count = io_count;
var report_io_bytes = io_count;
start();

function start() {
    setInterval(report, 1000);
    Q.fcall(function() {
            if (argv.server) {

                // register rpc service handler
                rpc.register_service(schema.bench, {
                    io: io_service
                });

                // open http listening port
                return rpc_http.create_server(rpc, argv.port)
                    .then(function(http_server) {
                        rpc_ws.listen(rpc, http_server);
                    });
            }
        })
        .then(function() {
            if (argv.client) {

                // run io with concurrency
                return Q.all(_.times(argv.concur, function() {
                    return call_next_io();
                }));
            }
        })
        .then(null, function(err) {
            dbg.error('BENCHMARK ERROR', err);
            process.exit(0);
        });
}

// test loop
function call_next_io(res) {
    if (res && res.data) {
        io_count += 1;
        io_bytes += res.data.length;
    }
    return bench_client.io({
            kushkush: {
                data: buffer
            }
        }, {
            no_fcall: argv.nofcall,
            address: argv.proto + '://' + argv.host + ':' + argv.port
        })
        .then(call_next_io);
}

function io_service(req) {
    dbg.log1('IO SERVICE');
    io_count += 1;
    io_bytes += req.params.kushkush.data.length;
    return {
        data: req.params.kushkush.data
    };
}

function report() {
    var now = Date.now();
    // deltas
    var d_time_start = (now - start_time) / 1000;
    var d_time = (now - report_time) / 1000;
    // velocities
    var v_count = (io_count - report_io_count) / d_time;
    var v_bytes = (io_bytes - report_io_bytes) / d_time;
    var v_count_start = io_count / d_time_start;
    var v_bytes_start = io_bytes / d_time_start;
    dbg.log0(
        '===', 'count', v_count.toFixed(1), 'avg', v_count_start.toFixed(1),
        '===', 'MB', (v_bytes / MB).toFixed(1), 'avg', (v_bytes_start / MB).toFixed(1),
        '===');
    report_time = now;
    report_io_count = io_count;
    report_io_bytes = io_bytes;
    if (argv.heap && !heapdiff) {
        memwatch.gc();
        heapdiff = new memwatch.HeapDiff();
    }
    if (argv.time && d_time_start >= argv.time) {
        dbg.log0('done.');
        if (heapdiff) {
            memwatch.gc();
            var diff = heapdiff.end();
            dbg.log('HEAPDIFF', util.inspect(diff, {
                depth: null
            }));
        }
        process.exit(0);
    }
}
