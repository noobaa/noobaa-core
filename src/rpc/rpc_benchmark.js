'use strict';

var _ = require('lodash');
var Q = require('q');
var util = require('util');
var argv = require('minimist')(process.argv);
var RPC = require('./rpc');
var RpcSchema = require('./rpc_schema');
var rpc_http = require('./rpc_http');
var rpc_ws = require('./rpc_ws');
var rpc_nudp = require('./rpc_nudp');
var stun = require('./stun');
var memwatch = require('memwatch');
var dbg = require('noobaa-util/debug_module')(__filename);
var MB = 1024 * 1024;

// test arguments
// time to run in seconds
argv.time = argv.time || undefined;
// io concurrency
argv.concur = argv.concur || 1;
// io size in bytes
argv.wsize = !_.isUndefined(argv.wsize) ? argv.wsize : MB;
argv.rsize = argv.rsize || 0;
// proto, host and port to use
argv.proto = argv.proto || 'ws';
argv.host = argv.host || '127.0.0.1';
argv.port = argv.port || 5656;
if (!(argv.proto in {
        http: 1,
        https: 1,
        ws: 1,
        wss: 1,
        nudp: 1,
        nudps: 1,
        fcall: 1,
    })) {
    throw new Error('BAD PROTOCOL ' + argv.proto);
}
var secure = argv.proto in {
    https: 1,
    wss: 1,
    nudps: 1
};
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
                        required: ['data', 'rsize'],
                        properties: {
                            data: {
                                type: 'buffer'
                            },
                            rsize: {
                                type: 'integer'
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

var io_count = 0;
var io_rbytes = 0;
var io_wbytes = 0;
var start_time = Date.now();
var report_time = start_time;
var report_io_count = 0;
var report_io_rbytes = 0;
var report_io_wbytes = 0;
start();

function start() {
    setInterval(report, 1000);
    Q.fcall(function() {

            // register rpc service handler
            if (argv.server) {
                rpc.register_service(schema.bench, {
                    io: io_service
                });
            }

            // open http listening port for http based protocols
            if (argv.server && argv.proto in {
                    http: 1,
                    https: 1,
                    ws: 1,
                    wss: 1,
                }) {
                return rpc_http.create_server(rpc, argv.port, secure)
                    .then(function(server) {
                        return rpc_ws.listen(rpc, server);
                    });
            }

            // open udp listening port for udp based protocols (needed also for client)
            if (argv.proto in {
                    nudp: 1,
                    nudps: 1,
                }) {
                return rpc_nudp.listen(rpc, argv.server ? argv.port : argv.port + 1)
                    .then(function(nudp_socket) {
                        bench_client.options.nudp_socket = nudp_socket;

                        // try connecting stun directly to peer
                        if (argv.stun) {
                            return stun.connect_socket(
                                nudp_socket.socket,
                                argv.host,
                                argv.server ? argv.port + 1 : argv.port);
                        }

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
            dbg.error('BENCHMARK ERROR', err.stack || err);
            process.exit(0);
        });
}

// test loop
function call_next_io(res) {
    if (res && res.data) {
        io_count += 1;
        io_rbytes += res.data.length;
        io_wbytes += argv.wsize;
    }
    return bench_client.io({
            kushkush: {
                data: new Buffer(argv.wsize),
                rsize: argv.rsize
            }
        }, {
            allow_fcall: argv.allow_fcall,
            address: argv.proto + '://' + argv.host + ':' + argv.port
        })
        .then(call_next_io);
}

function io_service(req) {
    dbg.log1('IO SERVICE');
    io_count += 1;
    io_rbytes += req.params.kushkush.data.length;
    io_wbytes += req.params.kushkush.rsize;
    return {
        data: new Buffer(req.params.kushkush.rsize)
    };
}

function report() {
    var now = Date.now();
    // deltas
    var d_time_start = (now - start_time) / 1000;
    var d_time = (now - report_time) / 1000;
    // velocities
    var v_count = (io_count - report_io_count) / d_time;
    var v_rbytes = (io_rbytes - report_io_rbytes) / d_time;
    var v_wbytes = (io_wbytes - report_io_wbytes) / d_time;
    var v_count_start = io_count / d_time_start;
    var v_rbytes_start = io_rbytes / d_time_start;
    var v_wbytes_start = io_wbytes / d_time_start;
    dbg.log0(
        ' |||  Count ', v_count.toFixed(3),
        ' (~' + v_count_start.toFixed(3) + ')',
        ' |||  Read ', (v_rbytes / MB).toFixed(3),
        'MB  (~' + (v_rbytes_start / MB).toFixed(3) + ')',
        ' |||  Write ', (v_wbytes / MB).toFixed(3),
        'MB  (~' + (v_wbytes_start / MB).toFixed(3) + ')',
        ' |||');
    report_time = now;
    report_io_count = io_count;
    report_io_rbytes = io_rbytes;
    report_io_wbytes = io_wbytes;
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
