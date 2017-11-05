/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const ssh2 = require('ssh2');
const argv = require('minimist')(process.argv);

const P = require('../util/promise');
const mongo_client = require('../util/mongo_client');
const buffer_utils = require('../util/buffer_utils');

argv.user = argv.user || 'notadmin';
argv.exec = argv.exec || 'uptime';
argv.input = argv.input || '';
argv.tty = argv.tti || false; // use --tti to read stdin from user

let nodes_left;

if (require.main === module) main();

function main() {
    return P.join(get_nodes_ips(), read_stdin())
        .spread(nodes_ssh);
}

function get_nodes_ips() {
    if (argv.ips) {
        return _.uniq(argv.ips.split(/,|\s+/))
            .map(ip => ({
                ip: ip.trim(),
                name: '--',
            }));
    }
    return P.resolve()
        .then(() => mongo_client.instance().connect())
        .then(() => mongo_client.instance().db.collection('nodes').find({
                deleted: null,
                is_cloud_node: null,
                is_mongo_node: null,
                is_internal_node: null,
            }, {
                fields: {
                    _id: 0,
                    name: 1,
                    ip: 1,
                }
            })
            .toArray()
        )
        .then(nodes => _.uniqBy(nodes, 'ip'));
}

function nodes_ssh(nodes) {
    nodes_left = new Set(nodes);
    console.log(`COMMAND: ${argv.exec}`);
    setInterval(log_progress, 1000).unref();
    return P.map(nodes, node => node_ssh(node).catch(_.noop), { concurrency: 10 })
        .then(() => {
            log_progress();
            console.log('done.');
            process.exit(0);
        });
}

function node_ssh(node) {
    const client = new ssh2.Client();
    client.can_continue = true;
    return new P((resolve, reject) => client
            .once('ready', resolve)
            .once('error', reject)
            .once('close', () => reject(new Error(`${node.ip} SSH CLOSED`)))
            .once('end', () => reject(new Error(`${node.ip} SSH ENDED`)))
            .connect({
                host: node.ip,
                port: 22,
                username: argv.user,
                password: argv.password,
                keepaliveInterval: 0, // disabled
                readyTimeout: 10000,
            }))
        .then(() => ssh_continue(client))
        .then(() => node_exec(node, client))
        .then(() => client.end())
        .catch(err => {
            console.error(`${node.ip} FAILED`, err);
            client.end();
            throw err;
        });
}

function node_exec(node, client) {
    return new P((resolve, reject) => {
        client.can_continue = client.exec(argv.exec, (err, channel) => {
            if (err) return reject(err);
            channel.once('error', reject);
            channel.once('close', (code, signal) => {
                nodes_left.delete(node);
                if (code === 0) return resolve();
                console.error(`${node.ip} EXIT CODE ${code}`);
                return reject(new Error(`${node.ip} EXIT CODE ${code}`));
            });
            channel.on('data', data => console.log(`${node.ip} STDOUT: ${data}`));
            channel.stderr.on('data', data => console.error(`${node.ip} STDERR: ${data}`));
            channel.end(argv.input);
        });
    });
}

function ssh_continue(client) {
    if (client.can_continue) return;
    return new P((resolve, reject) => client
        .once('continue', () => {
            client.can_continue = true;
            return resolve();
        })
        .once('error', reject)
        .once('close', () => reject(new Error('SSH CLOSED')))
        .once('end', () => reject(new Error('SSH ENDED')))
    );
}

function log_progress() {
    let partial_list = ' ';
    for (const node of nodes_left) {
        if (partial_list.length > 50) {
            partial_list += '... ';
            break;
        }
        partial_list += node.ip + ' ';
    }
    console.log(`----> ${nodes_left.size} nodes left [${partial_list}]`);
}

function read_stdin() {
    if (argv.input) return;
    if (process.stdin.isTTY && !argv.tti) return;
    return buffer_utils.buffer_from_stream(process.stdin)
        .then(buf => {
            argv.input = buf;
        });
}
