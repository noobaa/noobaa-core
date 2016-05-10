'use strict';

let _ = require('lodash');
let child_process = require('child_process');
// let argv = require('minimist')(process.argv);

/**
 *
 * This is a launcher for the server processes
 *
 */
const SERVICES = [{
    fork: './src/bg_workers/bg_workers_starter.js'
}, {
    fork: './src/server/web_server.js'
}, {
    fork: './src/s3/s3rver.js'
}, {
    fork: './src/agent/agent_cli.js',
    args: ['--scale', '6'],
}, {
    spawn: 'mongod',
    args: ['-f', 'mongod.conf']
}];

if (require.main === module) {
    main();
}

function main() {
    _.each(SERVICES, run_service);
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
