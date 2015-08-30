"use strict";

var _ = require('lodash');
var P = require('../../util/promise');
var argv = require('minimist')(process.argv);
var request = require('request');
var fs = require('fs');
var ec2_wrap = require('../../deploy/ec2_wrapper');
var ec2_deploy_agents = require('../../deploy/ec2_deploy_agents');
var promise_utils = require('../../util/promise_utils');
// var formData = require('form-data');

var default_instance_type = 'm3.large';

//TODO: add the --use_instace option
//TODO: on upload file, wait for systemOk ? (see next todo, maybe sleep too)
//TODO: sleep after agents creation until ready

function show_usage() {
    console.error('\nusage: node test_upgrade.js <--base_ami AMI_Image_name  | --use_instance instanceid> <--upgrade_pack path_to_upgrade_pack> [--region region] [--name name]');
    console.error('   example: node test_upgrade.js --base_ami AlphaV0.3 --upgrade_pack ../build/public/noobaa-NVA.tar.gz --region eu-central-1 --name \'New Alpha V0.3 Test\'');
    console.error('   example: node test_upgrade.js --user_instance i-9d1c955c --upgrade_pack ../build/public/noobaa-NVA.tar.gz --region eu-central-1');

    console.error('\n base_ami -\t\tThe AMI image name to use');
    console.error(' use_instance -\t\tThe already existing instance id to use');
    console.error(' upgrade_pack -\t\tPath to upgrade pack to use in the upgrade process');
    console.error(' region -\t\tRegion to look for the AMI and create the new instance. If not supplied taken from the .env');
    console.error(' name -\t\t\tName for the new instance. If not provided will be \'test_upgrade.js generated instance (AMI name)\'. Applicable only for new instances');

    console.error('\nMake sure .env contains the following values:');
    console.error('   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    console.error('   if AWS_REGION does not exist in .env, please provide the region using the --region option');

    console.error('\nIf creating a new instace, will also create a dockers instance with 10 agents in the same region');
    console.error('\n');
}

function upload_and_upgrade(ip, upgrade_pack, instance_id, target_region) {
    var filename;
    if (upgrade_pack.indexOf('/') !== -1) {
        filename = upgrade_pack.substring(upgrade_pack.indexOf('/'));
    } else {
        filename = upgrade_pack;
    }

    var formData = {
        upgrade_file: {
            value: fs.createReadStream(upgrade_pack),
            options: {
                filename: filename,
                contentType: 'application/x-gzip'
            }
        }
    };

    return P.ninvoke(request, 'post', {
            url: 'https://' + ip + '/upgrade',
            formData: formData,
            rejectUnauthorized: false,
        })
        .then(function(httpResponse, body) {
            console.log('Upload package successful');
            return;
        })
        .then(null, function(err) {
            console.error('Upload package failed', err, err.stack());
            throw new Error('Upload package failed ' + err);
        });
}

function get_agent_setup(ip) {
    return P.ninvoke(request, 'get', {
            url: 'https://' + ip + '/public/noobaa-setup.exe',
            rejectUnauthorized: false,
        })
        .then(function(response) {
            console.log('Download of noobaa-setup was successful');
            return;
        })
        .then(null, function(err) {
            console.error('Download of noobaa-setup failed', err);
            throw new Error('Download of noobaa-setup failed ' + err);
        });

}

function create_new_agents(target_ip, target_region) {
    var params = {
        access_key: process.env.AWS_ACCESS_KEY_ID,
        scale: 1,
        is_docker_host: true,
        is_win: false,
        filter_region: target_region,
        app: target_ip,
        dockers: 10,
        term: false,
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

function upload_file(ip) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //upload the file
            return P.fcall(function() {
                    return ec2_wrap.put_object(ip);
                })
                .then(function() {
                    console.log('Upload file successfully');
                })
                .then(null, function(err) {
                    console.error('Error in upload_file', err);
                    throw new Error('Error in upload_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err);
            throw new Error('Error in verify_demo_system ' + err);
        });
}

function download_file(ip) {
    return P.fcall(function() {
            //verify the 'demo' system exists on the instance
            return ec2_wrap.verify_demo_system(ip);
        })
        .then(function() {
            //upload the file
            return P.fcall(function() {
                    return ec2_wrap.get_object(ip);
                })
                .then(function() {
                    console.log('Download file successfully');
                })
                .then(null, function(err) {
                    console.error('Error in download_file', err);
                    throw new Error('Error in download_file ' + err);
                });
        })
        .then(null, function(err) {
            console.error('Error in verify_demo_system', err);
            throw new Error('Error in verify_demo_system ' + err);
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
    }
    if (_.isUndefined(argv.base_ami)) {
        missing_params = true;
    }
    if (_.isUndefined(argv.upgrade_pack)) {
        missing_params = true;
    }
    if (!_.isUndefined(argv.region)) {
        target_region = argv.region;
    } else if (!_.isUndefined(process.env.AWS_REGION)) {
        target_region = process.env.AWS_REGION;
    } else {
        missing_params = true;
    }
    if (!_.isUndefined(argv.name)) {
        name = argv.name;
    } else {
        name = 'test_upgrade.js generated instance (' + argv.base_ami + ')';
    }

    //Actual Test Logic
    if (!missing_params) {
        console.log("Starting test_upgrade.js, this can take some time...");
        return P.fcall(function() {
                return ec2_wrap.create_instance_from_ami(argv.base_ami, target_region, default_instance_type, name);
            })
            .then(function(res) {
                P.fcall(function() {
                        instance_id = res.instanceid;
                        return ec2_wrap.get_ip_address(instance_id);
                    })
                    .then(function(ip) {
                        target_ip = ip;
                        return upload_and_upgrade(target_ip, argv.upgrade_pack, instance_id, target_region);
                    })
                    .then(function() {
                        var params = ['--address=wss://' + target_ip];
                        return P.fcall(function() {
                            return promise_utils.promised_spawn('src/deploy/build_dockers.sh', params, process.cwd());
                        });
                    })
                    .then(function() {
                        return get_agent_setup(target_ip);
                    })
                    .then(function() {
                        return create_new_agents(target_ip, target_region);
                    })
                    .then(function() {
                        return upload_file(target_ip);
                    })
                    .then(function() {
                        return download_file(target_ip);
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
