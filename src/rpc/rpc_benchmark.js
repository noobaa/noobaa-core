'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var url = require('url');
var util = require('util');
var argv = require('minimist')(process.argv);
var RPC = require('./rpc');
var RpcSchema = require('./rpc_schema');
var memwatch = null; //require('memwatch');
var dbg = require('../util/debug_module')(__filename);
var MB = 1024 * 1024;

// test arguments

// time to run in seconds
argv.time = argv.time || undefined;

// io concurrency
argv.concur = argv.concur || 1;

// io size in bytes
argv.wsize = !_.isUndefined(argv.wsize) ? argv.wsize : MB;
argv.rsize = argv.rsize || 0;

// client/server mode
argv.client = argv.client || false;
argv.server = argv.server || false;
argv.n2n = argv.n2n || false;
argv.addr = url.parse(argv.addr || '');
argv.addr.protocol = argv.addr.protocol || 'ws:';
argv.addr.hostname = argv.addr.hostname || '127.0.0.1';
argv.addr.port = argv.addr.port || 5656;

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
    name: 'rpcbench',
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
        },
        n2n_signal: {
            method: 'POST',
            params: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            },
            reply: {
                type: 'object',
                additionalProperties: true,
                properties: {}
            }
        }
    }
});

// create rpc
var rpc = new RPC({
    schema: schema,
    base_address: url.format(argv.addr),
});

// register the rpc service handler
rpc.register_service(schema.rpcbench, {
    io: io_service,
    n2n_signal: function(req) {
        return rpc.n2n_signal(req.params);
    }
});

var io_rpc_options = {};

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
    P.fcall(function() {

            if (!argv.server) {
                return;
            }

            var secure = argv.addr.protocol in {
                'https:': 1,
                'wss:': 1,
            };

            var tcp = argv.addr.protocol in {
                'tcp:': 1,
                'tls:': 1,
            };

            if (tcp) {
                var pem = require('../util/pem');
                return P.nfcall(pem.createCertificate, {
                        days: 365 * 100,
                        selfSigned: true
                    })
                    .then(function(cert) {
                        return rpc.register_tcp_transport(argv.addr.port,
                            argv.addr.protocol === 'tls:' && {
                                key: cert.serviceKey,
                                cert: cert.certificate
                            });
                    });
            }

            // open http listening port for http based protocols
            return rpc.start_http_server(argv.addr.port, secure)
                .then(function(server) {
                    return rpc.register_ws_transport(server);
                });

        })
        .then(function() {

            if (!argv.n2n) {
                return;
            }

            // setup a signaller callback
            rpc.n2n_signaller = rpc.client.rpcbench.n2n_signal;

            // set rpc address to use n2n.
            // the hostname doesn't matter here since our signalling
            // is not using the url for routing.
            io_rpc_options.address = typeof(argv.n2n) === 'string' ?
                argv.n2n : 'n2n://unused';

            // open udp listening port for udp based protocols
            // (both server and client)
            return rpc.register_n2n_transport();

        })
        .then(function() {

            // start report interval (both server and client)
            setInterval(report, 1000);

            if (!argv.client) {
                return;
            }

            // run io with concurrency
            return P.all(_.times(argv.concur, function() {
                return call_next_io();
            }));

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
    return rpc.client.rpcbench.io({
            kushkush: {
                data: new Buffer(argv.wsize),
                rsize: argv.rsize
            }
        }, io_rpc_options)
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
