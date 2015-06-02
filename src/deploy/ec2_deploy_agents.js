"use strict";

var ec2_wrap = require('./ec2_wrapper');
var _ = require('lodash');
var argv = require('minimist')(process.argv);

function main() {

    if (_.isUndefined(process.env.AWS_ACCESS_KEY_ID)) {
        console.error('\n\n****************************************************');
        console.error('You must provide amazon cloud env details in .env:');
        console.error('AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION');
        console.error('****************************************************\n\n');
        return;
    }

    if (!_.isUndefined(argv.scale)) {
        var is_docker_host = false;
        var is_win = false;
        var filter_region = '';
        if (!_.isUndefined(argv.dockers)) {
            is_docker_host = true;
            console.log('starting ' + argv.dockers + ' dockers on each host');

        }
        if (_.isUndefined(argv.app)) {
            console.error('\n\n******************************************');
            console.error('Please provide --app (heroku app name)');
            console.error('******************************************\n\n');
            return;
        } else {
            ec2_wrap.set_app_name(argv.app);
        }

        if (!_.isUndefined(argv.win)) {
            is_win = true;
        }
        if (!_.isUndefined(argv.region)) {
            filter_region = argv.region;
        }

        // add a --term flag to allow removing nodes
        ec2_wrap.scale_instances(argv.scale, argv.term, is_docker_host, argv.dockers, is_win, filter_region)
            .then(function(res) {
                ec2_wrap.console_inspect('Scale: completed to ' + argv.scale, res);
                return ec2_wrap.describe_instances().then(ec2_wrap.print_instances);
            }, function(err) {
                if (err.message === 'allow_terminate') {
                    console.error('\n\n******************************************');
                    console.error('SCALE DOWN REJECTED');
                    console.error('Use --term flag to allow terminating nodes');
                    console.error('******************************************\n\n');
                    return;
                }
                throw err;
            })
            .done();

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
