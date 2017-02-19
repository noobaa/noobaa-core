/* Copyright (C) 2016 NooBaa */
'use strict';

let _ = require('lodash');
let child_process = require('child_process');
let argv = require('minimist')(process.argv);

/**
 *
 * This is a launcher for the server processes
 *
 */
const SERVICES = [{
    name: 'bg',
    fork: './src/server/bg_workers.js'
}, {
    name: 'web',
    fork: './src/server/web_server.js'
}, {
    name: 's3',
    fork: './src/s3/s3rver_starter.js'
}, {
    name: 'hosted_agents',
    fork: './src/hosted_agents/hosted_agents_starter.js'
}, {
    name: 'agents',
    fork: './src/agent/agent_cli.js',
    args: ['--scale', '20'],
    boot_delay: 5000
}, {
    name: 'mongo',
    spawn: 'mongod',
    args: ['-f', 'mongod.conf']
}];

if (require.main === module) {
    main();
}

function main() {
    let excludes = argv.exclude ? argv.exclude.split(',') : [];
    console.log('Excluding services:', excludes.join(' '));
    _.each(SERVICES, service => {
        if (excludes.indexOf(service.name) === -1) run_service(service);
    });
}

function run_service(srv) {

    // add default options - mainly to share stdout & stderr
    _.defaults(srv.opts, {
        stdio: 'inherit'
    });

    // handle re-entrancy
    if (srv.child) {

        // if we already have kill timeout we should wait for
        // the previous signals to finish processing
        if (!srv.kill_timeout) {

            // try to terminate the child gracefully with SIGTERM,
            // once the child will exit the 'exit' handler will re-run.
            srv.child.kill('SIGTERM');

            // also set a timer to send a less gracefull SIGKILL
            // in case the SIGTERM will be ignored, in any case the 'exit' handler
            // will clear the timer.
            srv.kill_timeout = setTimeout(() => {
                if (srv.child) {
                    srv.child.kill('SIGKILL');
                }
            }, 10000);
        }
        return;
    }

    if (srv.boot_delay && !srv.boot_timeout) {
        srv.boot_timeout = setTimeout(() => run_service(srv), srv.boot_delay);
        return;
    }

    console.log('SERVICE: running', srv.fork || srv.spawn, srv.args || '');
    srv.child = (srv.fork ?
            child_process.fork(srv.fork, srv.args, srv.opts) :
            child_process.spawn(srv.spawn, srv.args, srv.opts))
        .on('exit', (code, signal) => {
            console.warn('SERVICE: EXIT CODE', code, 'SIGNAL', signal);
            srv.child = null;
            if (srv.kill_timeout) {
                clearTimeout(srv.kill_timeout);
                srv.kill_timeout = null;
            }
            run_service(srv);
        });
}
