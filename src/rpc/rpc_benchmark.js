'use strict';

var _ = require('lodash');
var P = require('../util/promise');
// P.longStackTraces();
var url = require('url');
var util = require('util');
var argv = require('minimist')(process.argv);
var RPC = require('./rpc');
var pem = require('../util/pem');
var RpcSchema = require('./rpc_schema');
var chance = require('chance')();
var memwatch = null; //require('memwatch');
var dbg = require('../util/debug_module')(__filename);
var MB = 1024 * 1024;

// test arguments
// client/server mode
argv.client = argv.client || false;
argv.server = argv.server || false;

if (!argv.server && !argv.client) {
    let script_name = require('path').relative(process.cwd(), process.argv[1]);
    process.stdout.write('Usage: \n');
    process.stdout.write('node ' + script_name + ' --server --addr tcp://server:5656 [--n2n] \n');
    process.stdout.write('node ' + script_name + ' --client --addr tcp://server:5656 [--n2n] \n');
    process.stdout.write('(more flags are shown when running) \n');
    process.exit();
}

// time to run in seconds
argv.time = argv.time || undefined;
// io concurrency
argv.concur = argv.concur || 16;
// io size in bytes
argv.wsize = !_.isUndefined(argv.wsize) ? argv.wsize : MB;
argv.rsize = argv.rsize || 0;
argv.n2n = argv.n2n || false;
argv.nconn = argv.nconn || 1;
argv.closeconn = parseInt(argv.closeconn, 10) || 0;
argv.addr = url.parse(argv.addr || '');
argv.addr.protocol = (argv.proto && argv.proto + ':') || argv.addr.protocol || 'ws:';
argv.addr.hostname = argv.host || argv.addr.hostname || '127.0.0.1';
argv.addr.port = parseInt(argv.port, 10) || argv.addr.port || 5656;
argv.novalidation = argv.novalidation || false;

// retry delay in seconds on failures
argv.retry = argv.retry || undefined;
var retry_ms = 1000 * (parseInt(argv.retry, 10) || 0);
var retry_func = argv.retry && function() {
    return P.delay(retry_ms);
};

var target_addresses;

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
    id: 'rpcbench',
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
                                buffer: true
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
                        buffer: true
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
schema.compile();

// create rpc
var rpc = new RPC({
    schema: schema,
    router: {}
});
if (argv.novalidation) {
    rpc.disable_validation();
}
var client = rpc.new_client({
    address: url.format(argv.addr)
});

// register the rpc service handler
rpc.register_service(schema.rpcbench, {
    io: io_service,
    // when a signal is received, pass it to the n2n agent
    n2n_signal: req => rpc.accept_n2n_signal(req.params)
});

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

            if (argv.addr.protocol === 'nudp:') {
                return rpc.register_nudp_transport(argv.addr.port);
            }

            var tcp = argv.addr.protocol in {
                'tcp:': 1,
                'tls:': 1,
            };
            if (tcp) {
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

            var ntcp = argv.addr.protocol in {
                'ntcp:': 1,
                'ntls:': 1,
            };
            if (ntcp) {
                return P.nfcall(pem.createCertificate, {
                        days: 365 * 100,
                        selfSigned: true
                    })
                    .then(function(cert) {
                        return rpc.register_ntcp_transport(argv.addr.port,
                            argv.addr.protocol === 'ntls:' && {
                                key: cert.serviceKey,
                                cert: cert.certificate
                            });
                    });
            }

            var secure = argv.addr.protocol in {
                'https:': 1,
                'wss:': 1,
            };

            // open http listening port for http based protocols
            return rpc.start_http_server({
                port: argv.addr.port,
                secure: secure,
                logging: false,
                ws: true
            });
        })
        .then(function() {

            if (!argv.n2n) {
                target_addresses = [url.format(argv.addr)];
                return;
            }

            target_addresses = _.times(argv.nconn, function(i) {
                return 'n2n://conn' + i;
            });

            // register n2n and accept any peer_id
            var n2n_agent = rpc.register_n2n_agent(client.rpcbench.n2n_signal);
            n2n_agent.set_any_rpc_address();
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
function call_next_io(req) {
    if (req) {
        var reply = req.reply;
        if (reply && reply.data) {
            io_count += 1;
            io_rbytes += reply.data.length;
            io_wbytes += argv.wsize;
        }
        var conn = req.connection;
        if (conn && argv.closeconn) {
            setTimeout(function() {
                conn.close();
            }, argv.closeconn);
        }
    }
    var data = new Buffer(argv.wsize);
    data.fill(0xFA);
    var promise = client.rpcbench.io({
        kushkush: {
            data: data,
            rsize: argv.rsize
        }
    }, {
        address: chance.pick(target_addresses),
        return_rpc_req: true
    });
    if (retry_func) {
        promise = promise.catch(retry_func);
    }
    return promise.then(call_next_io);
}

function io_service(req) {
    dbg.log1('IO SERVICE');
    io_count += 1;
    io_rbytes += req.params.kushkush.data.length;
    io_wbytes += req.params.kushkush.rsize;
    var data = new Buffer(req.params.kushkush.rsize);
    data.fill(0x99);
    return {
        data: data
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
