/* Copyright (C) 2016 NooBaa */
'use strict';

// const _ = require('lodash');
const argv = require('minimist')(process.argv);
const cluster = require('cluster');
const mongodb = require('mongodb');

const api = require('../api');
const config = require('../../config');
const dotenv = require('../util/dotenv');
const Speedometer = require('../util/speedometer');
const { RPC_BUFFERS } = require('../rpc');
const { make_auth_token } = require('../server/common_services/auth_server');

dotenv.load();

argv.system = argv.system || 'demo';
argv.address = argv.address || '';
argv.forks = argv.forks || 1;
argv.concur = argv.concur || 32;
argv.count = argv.count || 256;
argv.size = argv.size || config.CHUNK_SPLIT_AVG_CHUNK;
argv.timeout = argv.timeout || 60000;

let block_index = 0;

const master_speedometer = new Speedometer('Total Speed');
const speedometer = new Speedometer('Block Store Speed');

if (argv.forks > 1 && cluster.isMaster) {
    master_speedometer.fork(argv.forks);
} else {
    main();
}

async function main() {
    console.log('ARGS', argv);
    const token = argv.token || make_auth_token({
        system: argv.system,
        role: 'admin',
        email: argv.email,
    });

    const rpc = api.new_rpc();
    const client = rpc.new_client();
    const signal_client = rpc.new_client();
    const n2n_agent = rpc.register_n2n_agent(((...args) => signal_client.node.n2n_signal(...args)));
    n2n_agent.set_any_rpc_address();
    client.options.auth_token = token;
    await Promise.all(Array(argv.concur).fill(0).map(() => worker(client)));
    process.exit();
}

async function worker(client) {
    while (block_index < argv.count) {
        block_index += 1;
        await write_block(client);
        speedometer.update(argv.size);
    }
}

async function write_block(client) {
    const block_id = new mongodb.ObjectId();
    return client.block_store.write_block({
        [RPC_BUFFERS]: { data: Buffer.allocUnsafe(argv.size) },
        block_md: {
            id: block_id,
            size: argv.size,
            address: argv.address,
        },
    }, {
        address: argv.address,
        timeout: argv.timeout,
    });
}
