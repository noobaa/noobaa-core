'use strict';

// var _ = require('lodash');
var Q = require('q');
var argv = require('minimist')(process.argv);
var RPC = require('./rpc');
var RpcSchema = require('./rpc_schema');
var rpc_http = require('./rpc_http');

var dbg = require('noobaa-util/debug_module')(__filename);
dbg.set_level(argv.d, __dirname);

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
                type: 'buffer'
            }
        }
    }
});

// create rpc
var rpc = new RPC();

// open http listening port
rpc_http.listen(rpc, 5656);

// register rpc service handler
rpc.register_service(schema.bench, {
    io: function(req) {
        return req.params.data;
    }
});

// create rpc client
var bench_client = rpc.create_client(schema.bench);

// test params
argv.ops = argv.ops || 10000;
argv.size = argv.size || 1024 * 1024;
var io_count = 0;
var buffer = new Buffer(argv.size);
var start_time = Date.now();

// test loop
function call_next_io() {
    if (io_count >= argv.ops) {
        return;
    }
    io_count += 1;
    if (io_count % 100 === 0) {
        dbg.log0('IO', io_count);
    }
    return bench_client.io({
            kushkush: {
                data: buffer
            }
        }, {
            // address: 'http://127.0.0.1:5656'
        })
        .then(call_next_io);
}

Q.fcall(call_next_io)
    .then(null, function(err) {
        dbg.error('BENCHMARK ERROR', err);
    })
    .then(function() {
        var took = (Date.now() - start_time) / 1000;
        dbg.warn('=======================');
        dbg.warn('IO Size  :', argv.size);
        dbg.warn('IO Count :', io_count);
        dbg.warn('IOPS     :', (io_count / took).toFixed(1));
        dbg.warn('=======================');
        process.exit(0);
    });
