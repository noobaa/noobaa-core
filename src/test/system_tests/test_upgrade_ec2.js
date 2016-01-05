"use strict";

var _ = require('lodash');
var P = require('../../util/promise');
var argv = require('minimist')(process.argv);
var request = require('request');
var ec2_wrap = require('../../deploy/ec2_wrapper');
var ec2_deploy_agents = require('../../deploy/ec2_deploy_agents');
var promise_utils = require('../../util/promise_utils');
var ops = require('./basic_server_ops');

var default_instance_type = 'm3.large';
//var default_instance_type = 't2.micro'; //TODO:: NBNB change back


//TODO: on upload file, wait for systemOk ? (see next todo, maybe sleep too)
//TODO: sleep after agents creation until ready

function show_usage() {
    console.error('\nusage: node test_upgrade_ec2.js <--base_ami AMI_Image_name  | --use_instance instanceid> <--upgrade_pack path_to_upgrade_pack> [--region region] [--name name]');
    console.error('   example: node test_upgrade_ec2.js --base_ami AlphaV0.3 --upgrade_pack ../build/public/noobaa-NVA.tar.gz --region eu-central-1 --name \'New Alpha V0.3 Test\'');
    console.error('   example: node test_upgrade_ec2.js --use_instance i-9d1c955c --upgrade_pack ../build/public/noobaa-NVA.tar.gz --region eu-central-1');
    console.error('Note: The demo system must exist either in the AMI or on the instance for the test to work');

    console.error('\n base_ami -\t\tThe AMI image name to use');
    console.error(' use_instance -\t\tThe already existing instance id to use');
    console.error(' upgrade_pack -\t\tPath to upgrade pack to use in the upgrade process');
    console.error(' region -\t\tRegion to look for the AMI and create the new instance. If not supplied taken from the .env');
    console.error(' name -\t\t\tName for the new instance. If not provided will be \'test_upgrade_ec2.js generated instance (AMI name)\'. Applicable only for new instances');

    console.error('\nMake sure .env contains the following values:');
    console.error('   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    console.error('   if AWS_REGION does not exist in .env, please provide the region using the --region option');

    console.error('\nIf creating a new instace, will also create a dockers instance with 10 agents in the same region');
    console.error('\n');
}

function create_new_agents(target_ip, target_region) {
    var new_conf = JSON.stringify({
        "dbg_log_level": 2,
        "tier": "nodes",
        "prod": true,
        "bucket": "files",
        "root_path": "./agent_storage/",
        "address": "wss://127.0.0.1:8443",
        "system": "demo",
        "access_key": "123",
        "secret_key": "abc"
    });
    new_conf = new_conf.replace('127.0.0.1', target_ip);
    var base_conf = new Buffer(new_conf).toString('base64');
    //console.log('base_conf',base_conf,'new_conf',new_conf);
    //return;

    var params = {
        access_key: process.env.AWS_ACCESS_KEY_ID,
        scale: 1,
        is_docker_host: true,
        is_win: false,
        filter_region: target_region,
        app: target_ip,
        dockers: 10,
        term: false,
        agent_conf: base_conf
    };

    return P.fcall(function() {
            return ec2_deploy_agents.deploy_agents(params);
        })
        .then(function() {
            console.log('successfully created a new intance with 10 docker agents');
            return;
        })
        .then(null, function(err) {
            console.error('Error in creating new instance for agents ', err);
            throw new Error('Error in creating new instance for agents ' + err);
        });

}

function main() {
    var missing_params = false;
    var target_region;
    var name;
    var target_ip;
    var instance_id;

    //Verify Input Parameters
    if (_.isUndefined(process.env.AWS_ACCESS_KEY_ID)) {
        missing_params = true;
        console.error('missing aws');
    } else if (_.isUndefined(argv.base_ami) && _.isUndefined(argv.use_instance)) {
        missing_params = true;
        console.error('missing base');
    } else if (_.isUndefined(argv.upgrade_pack)) {
        missing_params = true;
        console.error('missing upgrade_pack');
    } else if (!_.isUndefined(argv.region)) {
        target_region = argv.region;
    } else if (!_.isUndefined(process.env.AWS_REGION)) {
        target_region = process.env.AWS_REGION;
    } else {
        missing_params = true;
        console.error('missing region');
    }
    if (!_.isUndefined(argv.name)) {
        name = argv.name;
    } else {
        name = 'test_upgrade_ec2.js generated instance (' + argv.base_ami + ')';
    }

    //Actual Test Logic
    if (!missing_params) {
        console.log("Starting test_upgrade_ec2.js, this can take some time...");
        return P.fcall(function() {
                if (!_.isUndefined(argv.base_ami)) {
                    return ec2_wrap.create_instance_from_ami(argv.base_ami, target_region, default_instance_type, name);
                } else {
                    return {
                        instanceid: argv.use_instance
                    };
                }
            })
            .then(function(res) {
                return P.fcall(function() {
                        instance_id = res.instanceid;
                        return ec2_wrap.get_ip_address(instance_id);
                    })
                    .then(function(ip) {
                        target_ip = ip;
                        var isNotListening = true;
                        return promise_utils.pwhile(
                            function() {
                                return isNotListening;
                            },
                            function() {
                                return P.ninvoke(request, 'get', {
                                    url: 'http://' + ip + ':8080/',
                                    rejectUnauthorized: false,
                                }).then(function(res, body) {
                                    console.log('server started');
                                    isNotListening = false;
                                }, function(err) {
                                    console.log('waiting for server to start');
                                    return P.delay(10000);
                                });
                            }).then(function() {
                            return ops.upload_and_upgrade(target_ip, argv.upgrade_pack);
                        });
                    })
                    .then(function() {
                        return ops.get_agent_setup(target_ip);
                    })
                    .then(function() {
                        return create_new_agents(target_ip, target_region);
                    })
                    .then(function() {
                        console.log('Generating a 100MB random test file for upload');
                        return ops.generate_random_file(100);
                    })
                    .then(function(fname) {
                        return ops.upload_file(target_ip, fname);
                    })
                    .then(function() {
                        return ops.download_file(target_ip);
                    })
                    .then(function() {
                        console.log('Test Done');
                        return;
                    })
                    .then(null, function(error) {
                        console.error('ERROR: test_upgrade FAILED', error);
                        process.exit(2);
                    });
            })
            .then(null, function(error) {
                console.error('ERROR: while creating instance', error);
                process.exit(1);
            });
    } else {
        show_usage();
        process.exit(3);
        return;
    }
}

if (require.main === module) {
    main();
}
