"use strict";

var _ = require('lodash');
var Q = require('q');
var argv = require('minimist')(process.argv);
var request = require('request');
var fs = require('fs');
var ec2_wrap = require('../../deploy/ec2_wrapper');
var formData = require('form-data');

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

function upload_and_upgrade(ip, upgrade_pack) {
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

    var deferred = Q.defer();

    request.post({
        url: 'https://' + ip + '/upgrade',
        formData: formData,
        rejectUnauthorized: false,
    }, function optionalCallback(err, httpResponse, body) {
        if (err) {
            console.error('upload failed', err);
            deferred.reject(new Error('upload failed ' + err));
        }
        deferred.resolve();
        console.log('Upload successful');
    });

    return deferred.promise;
}

function get_agent_setup(ip) {
    console.log("Getting agent");
    var deferred = Q.defer();
    request.get({
            url: 'https://' + ip + '/public/noobaa-setup.exe',
            rejectUnauthorized: false,
        })
        .on('response', function(response) {
            console.log('Download of noobaa-setup was successful');
            deferred.resolve();
        })
        .on('error', function(err) {
            console.error('Download of noobaa-setup failed', err);
            deferred.reject(new Error('Download of noobaa-setup failed ' + err));
        });
    return deferred.promise;
}

function list_buckets(ip) {

}

function upload_file(ip) {

}

function download_file(ip) {

}

function main() {
    var missing_params = false;
    var target_region;
    var name = '';
    var target_ip;

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
    }

    //Actual Test Logic
    if (!missing_params) {
        Q.fcall(function() {
                return ec2_wrap.create_instance_from_ami(argv.base_ami, target_region, default_instance_type, name);
            })
            .then(function(res) {
                Q.fcall(function() {
                        return ec2_wrap.get_ip_address(res.instanceid);
                    })
                    .then(function(ip) {
                        target_ip = ip;
                        console.log('Uploading to', ip, 'and upgrading...');
                        return upload_and_upgrade(target_ip, argv.upgrade_pack);
                    })
                    .then(function() {
                        return get_agent_setup(target_ip);
                    })
                    .then(function() {
                        return list_buckets(target_ip);
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
