"use strict";

var ec2_wrap = require('../../deploy/ec2_wrapper');
var _ = require('lodash');
var Q = require('q');
var util = require('util');
var argv = require('minimist')(process.argv);

var default_instance_type = 'm3.large';

function show_usage() {
    console.error('\nusage: node test_upgrade.js <--base_ami AMI_Image_name> <--upgrade_pack path_to_upgrade_pack> [--region region] [--name name]');
    console.error('example: node test_upgrade.js --base_ami AlphaV0.3 --upgrade_pack ../build/public/noobaa-NVA.tar.gz --region eu-central-1 --name \'New Alpha V0.3 Test\'');

    console.error('\n base_ami -\t\tThe AMI image name to use');
    console.error(' upgrade_pack -\t\tPath to upgrade pack to use in the upgrade process');
    console.error(' region -\t\tRegion to look for the AMI and create the new instance. If not supplied taken from the .env');
    console.error(' name -\t\t\tName for the new instance. If not provided will be blank');

    console.error('\nMake sure .env contains the following values:');
    console.error('   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    console.error('   if AWS_REGION does not exist in .env, please provide the region using the --region option');
    console.error('\n');
}

function upload_and_upgrade(ip) {

}

function main() {
    var missing_params = false;
    var target_region;
    var name = '';

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
    }

    if (!missing_params) {
        Q.fcall(function() {
                return ec2_wrap.create_instance_from_ami(argv.base_ami, target_region, default_instance_type, name);
            })
            .then(function(res) {
                Q.fcall(function() {
                        return ec2_wrap.get_ip_address(res.instanceid);
                    })
                    .then(function(res) {
                        return upload_and_upgrade(res);
                    })
                    .then(function() {
                        //List buckets
                    })
                    .then(function() {
                        //get Agent setup file
                    })
                    .then(function() {
                        //ul file S3
                    })
                    .then(function() {
                        //dl file S3
                    });
            })
            .then(null, function(error) {
                console.error("ERROR: while creating instance", error);
            });

    } else {
        show_usage();
        return;
    }
}

if (require.main === module) {
    main();
}
