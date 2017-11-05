/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const argv = require('minimist')(process.argv);
const crypto = require('crypto');

const P = require('../util/promise');
const api = require('../api');
const dotenv = require('../util/dotenv');
const { RPC_BUFFERS } = require('../rpc');

dotenv.load();

argv.email = argv.email || 'demo@noobaa.com';
argv.password = argv.password || 'DeMo1';
argv.system = argv.system || 'demo';
argv.address = argv.address || '';
argv.concur = argv.concur || 10;
argv.count = argv.count || 100;
argv.size = argv.size || 1024 * 1024;
argv.timeout = argv.timeout || 60000;

const rpc = api.new_rpc();
const client = rpc.new_client();

function main() {
    console.log('ARGS', argv);
    let signal_client = rpc.new_client();
    let n2n_agent = rpc.register_n2n_agent(signal_client.node.n2n_signal);
    n2n_agent.set_any_rpc_address();
    return client.create_auth_token({
            email: argv.email,
            password: argv.password,
            system: argv.system,
        })
        .then(() => write_blocks())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

function write_blocks() {
    let index = 0;

    function write_next() {
        if (index >= argv.count) return;
        index += 1;
        return write_block(index).then(write_next);
    }
    return P.all(_.times(argv.concur, write_next));

}

function write_block(index) {
    const block_id = `agent_speed_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    console.log('write_block: START', block_id);
    return P.resolve()
        .then(() => client.block_store.write_block({
            [RPC_BUFFERS]: { data: Buffer.allocUnsafe(argv.size) },
            block_md: {
                id: block_id,
                address: argv.address,
                // node: '',
                size: argv.size,
            },
        }, {
            address: argv.address,
            timeout: argv.timeout,
        }))
        .then(() => console.log('write_block: DONE'))
        .catch(err => console.error('write_block: ERROR', err.stack || err));
}

if (require.main === module) main();
