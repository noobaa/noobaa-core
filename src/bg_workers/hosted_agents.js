'use strict';

var supervisor = require('../server/utils/supervisor_ctrl.js');
var _ = require('lodash');
var dbg = require('../util/debug_module')(__filename);
var child_process = require('child_process');


exports.create_agent = create_agent;
exports.remove_agent = remove_agent;




function create_agent(req) {
    let port = process.env.SSL_PORT || 5443;
    let args = ['--address', 'wss://127.0.0.1:' + port, '--node_name', req.params.name];

    if (req.params.scale) {
        // regular agents
        args = args.concat(['--scale', req.params.scale.toString()]);
    }

    if (req.params.cloud_info) {
        // cloud agents
        args = args.concat([
            '--cloud_endpoint', req.params.cloud_info.endpoint,
            '--cloud_bucket', req.params.cloud_info.target_bucket,
            '--cloud_access_key', req.params.cloud_info.access_keys.access_key,
            '--cloud_secret_key', req.params.cloud_info.access_keys.secret_key
        ]);
    }

    if (req.params.storage_limit) {
        args = args.concat(['--storage_limit', req.params.storage_limit.toString()]);
    }

    if (req.params.access_keys) {
        args = args.concat([
            '--access_key', req.params.access_keys.access_key,
            '--secret_key', req.params.access_keys.secret_key
        ]);
    }

    if (process.env.DEBUG_MODE === 'true') {
        args.splice(0, 0, 'src/agent/agent_cli.js');
        dbg.log0('executing: node', _.join(args, ' '));
        let child = child_process.spawn('node', args, {
            stdio: 'inherit'
        });
        dbg.log0('spawned process. pid =', child.pid);
    } else {
        dbg.log0('adding agent to supervior with arguments:', _.join(args, ' '));
        return supervisor.add_agent(req.params.name, _.join(args, ' '));
    }
}


function remove_agent(req) {
    return supervisor.remove_program(req.params.name)
        .then(() => supervisor.apply_changes());
}
