"use strict";

var ec2_wrap = require('./ec2_wrapper');
var _ = require('lodash');
var Q = require('q');
var argv = require('minimist')(process.argv);

module.exports = {
    deploy_agents: deploy_agents,
};

function deploy_agents(params) {
    ec2_wrap.set_app_name(params.app);
    // add a --term flag to allow removing nodes
    return Q.fcall(function() {
            return ec2_wrap.scale_agent_instances(params.scale, params.term, params.is_docker_host, params.dockers, params.is_win, params.filter_region);
        })
        .then(function(res) {
            ec2_wrap.console_inspect('Scale: completed to ' + params.scale, res);
            return;
            //return ec2_wrap.describe_instances().then(ec2_wrap.print_instances);
        })
        .then(null, function(err) {
            if (err.message.indexOf('allow_terminate') !== -1) {
                console.error('\n\n******************************************');
                console.error('SCALE DOWN REJECTED');
                console.error('Use --term flag to allow terminating nodes');
                console.error('******************************************\n\n');
            }
            throw err;
        });

}


function main() {
    var params = {
        access_key: '',
        scale: 0,
        is_docker_host: false,
        is_win: false,
        filter_region: '',
        app: '',
        dockers: 0,
        term: false,
    };

    if (_.isUndefined(process.env.AWS_ACCESS_KEY_ID)) {
        console.error('\n\n****************************************************');
        console.error('You must provide amazon cloud env details in .env:');
        console.error('AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION');
        console.error('****************************************************\n\n');
        return;
    } else {
        params.access_key = process.env.AWS_ACCESS_KEY_ID;
    }

    if (!_.isUndefined(argv.scale)) {
        params.scale = argv.scale;
        params.is_docker_host = false;
        params.is_win = false;
        params.filter_region = '';
        if (!_.isUndefined(argv.dockers)) {
            params.is_docker_host = true;
            console.log('starting ' + argv.dockers + ' dockers on each host');
        }

        params.dockers = argv.dockers;

        if (_.isUndefined(argv.app)) {
            console.error('\n\n******************************************');
            console.error('Please provide --app (heroku app name)');
            console.error('******************************************\n\n');
            return;
        } else {
            params.app = argv.app;
        }

        if (!_.isUndefined(argv.win)) {
            params.is_win = true;
        }
        if (!_.isUndefined(argv.region)) {
            params.filter_region = argv.region;
        }

        params.term = argv.term;
        return Q.fcall(function() {
                return deploy_agents(params);
            })
            .then(null, function(err) {
                console.error('Error on deploy_agents', err);
                throw new Error('Error on deploy_agents ' + err);
            });

    } else if (!_.isUndefined(argv.instance)) {

        ec2_wrap.describe_instance(argv.instance)
            .then(function(instance) {
                ec2_wrap.console_inspect('Instance ' + argv.instance + ':', instance);
            })
            .done();

    } else {
        ec2_wrap.describe_instances().then(ec2_wrap.print_instances).done();
    }
}

if (require.main === module) {
    main();
}
