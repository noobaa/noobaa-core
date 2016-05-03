'use strict';

var supervisor = require('../server/utils/supervisor_ctrl.js');
var _ = require('lodash');
var dbg = require('../util/debug_module')(__filename);
var child_process = require('child_process');


exports.create_agent = create_agent;
exports.remove_agent = remove_agent;




function create_agent(req) {
    let args = [];
    if (_.isUndefined(req.params.cloud_info)) {
        // regular agents
        args = ['--internal_agent', '--scale', req.params.scale.toString()];
    } else {
        // cloud agents
        args = [
            '--cloud_endpoint', req.params.cloud_info.endpoint,
            '--cloud_bucket', req.params.cloud_info.target_bucket,
            '--cloud_access_key', req.params.cloud_info.access_keys.access_key,
            '--cloud_secret_key', req.params.cloud_info.access_keys.secret_key,
            '--cloud_pool_name', req.params.name,
            '--internal_agent'
        ];
    }
    if (process.env.DEBUG_MODE === 'true') {
        args.splice(0, 0, 'src/agent/agent_cli.js');
        dbg.log0('executing agent_cli with arguments:', _.join(args, ' '));
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
    supervisor.remove_agent(req.params.name);
}