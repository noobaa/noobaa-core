/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const url = require('url');
const path = require('path');
const util = require('util');
const argv = require('minimist')(process.argv);
const chance = require('chance')();
const memwatch = null; //require('memwatch');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const RPC = require('./rpc');
const RpcSchema = require('./rpc_schema');
const ssl_utils = require('../util/ssl_utils');
const { RPC_BUFFERS } = require('.');

const MB = 1024 * 1024;

// test arguments
// client/server mode
argv.client = argv.client || false;
argv.server = argv.server || false;

if (argv.help || (!argv.server && !argv.client)) {
    let script_name = path.relative(process.cwd(), process.argv[1]);
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
argv.wsize = _.isUndefined(argv.wsize) ? MB : argv.wsize;
argv.rsize = argv.rsize || 0;
argv.n2n = argv.n2n || false;
argv.nconn = argv.nconn || 1;
argv.closeconn = Number(argv.closeconn) || 0;
argv.addr = url.parse(argv.addr || '');
argv.addr.protocol = (argv.proto && argv.proto + ':') || argv.addr.protocol || 'ws:';
argv.addr.hostname = argv.host || argv.addr.hostname || '127.0.0.1';
argv.addr.port = Number(argv.port) || argv.addr.port || 5656;
argv.novalidation = argv.novalidation || false;

// retry delay in seconds on failures
argv.retry = argv.retry || undefined;
const retry_ms = 1000 * (Number(argv.retry) || 0);
const retry_func = argv.retry && (() => P.delay(retry_ms));

let target_addresses;

// debug level
argv.debug = argv.debug || 0;

// profiling tools
if (argv.leak) {
    memwatch.on('leak', info => dbg.warn('LEAK', info));
}
let heapdiff;
argv.heap = argv.heap || false;

dbg.log('Arguments', argv);
dbg.set_level(argv.debug, __dirname);

const schema = new RpcSchema();
schema.register_api({
    id: 'rpcbench',
    methods: {
        io: {
            method: 'POST',
            params: {
                type: 'object',
                required: ['wsize', 'rsize'],
                properties: {
                    wsize: { type: 'integer' },
                    rsize: { type: 'integer' },
                }
            },
            reply: {
                type: 'object',
                required: ['wsize', 'rsize'],
                properties: {
                    wsize: { type: 'integer' },
                    rsize: { type: 'integer' },
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
const rpc = new RPC({
    schema: schema,
    router: {}
});
if (argv.novalidation) {
    rpc.disable_validation();
}
const client = rpc.new_client({
    address: url.format(argv.addr)
});

// register the rpc service handler
rpc.register_service(schema.rpcbench, {
    io: io_service,
    // when a signal is received, pass it to the n2n agent
    n2n_signal: req => rpc.accept_n2n_signal(req.params)
});

let io_count = 0;
let io_rbytes = 0;
let io_wbytes = 0;
const start_time = Date.now();
let report_time = start_time;
let report_io_count = 0;
let report_io_rbytes = 0;
let report_io_wbytes = 0;
start();

function start() {
    P.resolve()
        .then(() => {
            const proto = argv.addr.protocol;

            if (!argv.server) return;

            if (proto === 'nudp:') {
                return rpc.register_nudp_transport(argv.addr.port);
            }

            if (proto === 'tcp:' || proto === 'tls:') {
                return rpc.register_tcp_transport(argv.addr.port,
                    proto === 'tls:' && ssl_utils.generate_ssl_certificate()
                );
            }

            if (proto === 'ntcp:' || proto === 'ntls:') {
                return rpc.register_ntcp_transport(argv.addr.port,
                    proto === 'ntls:' && ssl_utils.generate_ssl_certificate()
                );
            }

            // open http listening port for http based protocols
            return rpc.start_http_server({
                port: argv.addr.port,
                protocol: proto,
                logging: false,
            });
        })
        .then(() => {

            if (!argv.n2n) {
                target_addresses = [url.format(argv.addr)];
                return;
            }

            target_addresses = _.times(argv.nconn, i => 'n2n://conn' + i);

            // register n2n and accept any peer_id
            const n2n_agent = rpc.register_n2n_agent(client.rpcbench.n2n_signal);
            n2n_agent.set_any_rpc_address();
        })
        .then(() => {

            // start report interval (both server and client)
            setInterval(report, 1000);

            if (!argv.client) return;

            // run io with concurrency
            return P.all(_.times(argv.concur, () => call_next_io()));

        })
        .catch(err => {
            dbg.error('BENCHMARK ERROR', err.stack || err);
            process.exit(0);
        });
}

// test loop
function call_next_io(req) {
    if (req) {
        const reply = req.reply;
        if (reply) {
            io_count += 1;
            io_wbytes += argv.wsize;
            if (reply.data) {
                io_rbytes += reply.data.length;
            }
        }
        const conn = req.connection;
        if (conn && argv.closeconn) {
            setTimeout(() => {
                conn.close();
            }, argv.closeconn);
        }
    }
    const data = Buffer.alloc(argv.wsize, 0xFA);
    let promise = client.rpcbench.io({
        [RPC_BUFFERS]: { data },
        wsize: argv.wsize,
        rsize: argv.rsize,
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
    const data_in = req.params[RPC_BUFFERS] && req.params[RPC_BUFFERS].data;
    const data = Buffer.alloc(req.params.rsize, 0x99);
    io_count += 1;
    io_rbytes += data_in ? data_in.length : 0;
    io_wbytes += data.length;
    return {
        [RPC_BUFFERS]: { data },
        wsize: req.params.wsize,
        rsize: req.params.rsize,
    };
}

function report() {
    const now = Date.now();
    // deltas
    const d_time_start = (now - start_time) / 1000;
    const d_time = (now - report_time) / 1000;
    // velocities
    const v_count = (io_count - report_io_count) / d_time;
    const v_rbytes = (io_rbytes - report_io_rbytes) / d_time;
    const v_wbytes = (io_wbytes - report_io_wbytes) / d_time;
    const v_count_start = io_count / d_time_start;
    const v_rbytes_start = io_rbytes / d_time_start;
    const v_wbytes_start = io_wbytes / d_time_start;
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
            const diff = heapdiff.end();
            dbg.log('HEAPDIFF', util.inspect(diff, { depth: null }));
        }
        process.exit(0);
    }
}
