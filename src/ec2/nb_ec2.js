"use strict";

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var async = require('async');
var dotenv = require('dotenv');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');
Q.longStackSupport = true;


/**
 *
 * NB_EC2
 *
 * noobaa's ec2 wrapper
 *
 */
var nb_ec2 = {
    scale_instances: scale_instances,
    describe_instances: describe_instances,
    describe_instance: describe_instance,
    terminate_instances: terminate_instances,
    import_key_pair_to_region: import_key_pair_to_region,
};

module.exports = nb_ec2;


/* load aws config from env */

if (!process.env.AWS_ACCESS_KEY_ID) {
    console.log('loading .env file...');
    dotenv.load();
}

// AWS.config.loadFromPath('./env.js');
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'us-east-1',
    // region: process.env.AWS_REGION,
});

var KEY_PAIR_PARAMS = {
    KeyName: 'noobaa-demo',
    PublicKeyMaterial: fs.readFileSync(__dirname + '/noobaa-demo.pub')
};

// the run script to send to started instances
var run_script = fs.readFileSync(__dirname + '/run_agent.sh')
    .replace('$ADDRESS', process.env.ADDRESS);



/**
 *
 * get_regions
 *
 */
function get_regions(func) {
    return ec2_call('describeRegions');
}


/**
 *
 * foreach_region
 *
 * @param func is function(region) that can return a promise.
 * @return promise for array of results per region func.
 *
 */
function foreach_region(func) {
    return get_regions()
        .then(function(res) {
            return Q.all(_.map(res.Regions, func));
        });
}


/**
 *
 * describe_instances
 *
 * @return instance array with entry per region,
 *      each entry is array of instance info.
 *
 */
function describe_instances(params) {
    return foreach_region(function(region) {
            return ec2_region_call(region.RegionName, 'describeInstances', params)
                .then(function(res) {
                    // return a flat array of instances from res.Reservations[].Instances[]
                    return _.flatten(res.Reservations, 'Instances');
                });
        })
        .then(function(res) {
            // flatten again for all regions
            return _.flatten(res);
        });
}



/**
 *
 * describe_instance
 *
 * @return info of single instance
 *
 */
function describe_instance(instance_id) {
    return describe_instances({
            InstanceIds: [instance_id]
        })
        .then(function(res) {
            return res[0];
        });
}



/**
 *
 * scale_instances
 *
 */
function scale_instances(count) {

    return get_regions().then(function(data) {

        var target_region_count = 0;
        var first_region_extra_count = 0;
        if (count < data.Regions.length) {
            // if number of instances is smaller than the number of regions,
            // we will add one instance per region until we have enough instances.
            if (count === 0) {
                target_region_count = 0;
            } else {
                target_region_count = 1;
            }
        } else {
            // divide instances equally per region.
            // the first region will get the redundant instances
            target_region_count = Math.floor(count / data.Regions.length);
            first_region_extra_count = (count % data.Regions.length);
            if (target_region_count > 20) {
                target_region_count = 20;
                first_region_extra_count = 0;
                console.log('Cannot scale to over 20 instances per region. will scale to 20');
            }
        }

        console.log('Scale:', target_region_count, 'per region');
        console.log('Scale:', first_region_extra_count, 'extra in first region');

        var new_count = 0;
        return Q.all(_.map(data.Regions, function(region) {
            var region_count = 0;
            if (new_count < count) {
                if (first_region_extra_count > 0 &&
                    region.RegionName === data.Regions[0].RegionName) {
                    region_count = target_region_count +
                        first_region_extra_count;
                } else {
                    region_count = target_region_count;
                }
                new_count += region_count;
            }

            return scale_region(region.RegionName, region_count);
        }));
    });
}


/**
 *
 * scale_region
 *
 */
function scale_region(region_name, count) {
    return create_security_group(region_name)
        .then(function() {
            return import_key_pair_to_region(region_name);
        })
        .then(function() {
            return ec2_region_call(region_name, 'describeInstances', {
                Filters: [{
                    Name: 'instance-state-name',
                    Values: ['running', 'pending']
                }]
            });
        })
        .then(function(res) {
            var instances = _.flatten(res.Reservations, 'Instances');

            // need to create
            if (count > instances.length) {
                console.log('ScaleRegion:', region_name,
                    'has', instances.length, 'add', count - instances.length);
                return add_region_instances(region_name, count - instances.length);
            }

            // need to terminate
            if (count < instances.length) {
                console.log('ScaleRegion:', region_name,
                    'has', instances.length, 'remove', count);
                var death_row = _.first(instances, instances.length - count);
                var ids = _.pluck(death_row, 'InstanceId');
                return terminate_instances(region_name, ids);
            }

            console.log('ScaleRegion:', region_name,
                'has', instances.length, 'unchanged :)');
        });
}


/**
 *
 * add_region_instances
 *
 */
function add_region_instances(region_name, count) {
    return Q
        .fcall(get_ami_image_id, region_name)
        .then(function(ami_image_id) {
            console.log('AddInstance:', region_name, count, ami_image_id);
            return ec2_region_call(region_name, 'runInstances', {
                ImageId: ami_image_id,
                MaxCount: count,
                MinCount: count,
                InstanceType: 't2.micro',
                KeyName: KEY_PAIR_PARAMS.KeyName,
                SecurityGroups: ['ssh_and_http_v2'],
                UserData: new Buffer(run_script).toString('base64'),
            });
        });
}


var _cached_ami_image_id;

/**
 *
 * get_ami_image_id
 *
 * @return the image id and save in memory for next calls
 *
 */
function get_ami_image_id(region_name) {
    // if (_cached_ami_image_id) return _cached_ami_image_id;

    return ec2_region_call(region_name, 'describeImages', {
            Filters: [{
                Name: 'name',
                Values: [
                    'ubuntu/images/hvm-ssd/ubuntu-trusty-14.04-amd64-server-20140927',
                ]
            }]
        })
        .then(function(res) {
            _cached_ami_image_id = res.Images[0].ImageId;
            return _cached_ami_image_id;
        });
}



/**
 *
 * terminate_instance
 *
 * @param instance_ids array of ids.
 */
function terminate_instances(region_name, instance_ids) {
    console.log('Terminate:', region_name, 'terminating',
        instance_ids.length, 'instances -', instance_ids);
    return ec2_region_call(region_name, 'terminateInstances', {
        InstanceIds: instance_ids,
    }).then(null, function(err) {
        if (err.code === 'InvalidInstanceID.NotFound') {
            console.error(err);
            return;
        }
        throw err;
    });
}



/**
 *
 * import_key_pair_to_region
 *
 */
function import_key_pair_to_region(region_name) {
    return ec2_region_call(region_name, 'importKeyPair', KEY_PAIR_PARAMS)
        .then(function(res) {
            console.log('KeyPair: imported', res.KeyName);
        }, function(err) {
            if (err.code === 'InvalidKeyPair.Duplicate') return;
            throw err;
        });
}



/**
 *
 * create_security_group
 *
 */
function create_security_group(region_name) {
    var ssh_and_http_v2 = 'ssh_and_http_v2';
    return ec2_region_call(region_name, 'describeSecurityGroups', {
            GroupNames: [ssh_and_http_v2]
        })
        .then(function(securityGroupData) {
            // console.log('SecurityGroup: already exists');
        })
        .then(null, function(err) {
            console.log('SecurityGroup: will create for region', region_name);
            return ec2_region_call(region_name, 'createSecurityGroup', {
                    Description: ssh_and_http_v2,
                    GroupName: ssh_and_http_v2
                })
                .then(function(data) {
                    console.log('SecurityGroup: created');
                    return ec2_region_call(region_name, 'authorizeSecurityGroupIngress', {
                            GroupId: data.GroupId,
                            GroupName: ssh_and_http_v2,
                            IpPermissions: [{
                                    FromPort: 22,
                                    IpProtocol: 'tcp',
                                    ToPort: 22,
                                    IpRanges: [{
                                        CidrIp: '0.0.0.0/0'
                                    }]
                                }, {
                                    FromPort: 80,
                                    IpProtocol: 'tcp',
                                    ToPort: 80,
                                    IpRanges: [{
                                        CidrIp: '0.0.0.0/0'
                                    }]
                                },
                                /* more items */
                            ]
                        })
                        .then(function(data) {
                            console.log('SecurityGroup: Opened port 22 and 80');
                        }, function(err) {
                            console.log('SecurityGroup: Rules exist');
                        });
                }, function(err) {
                    console.log('SecurityGroup: create failed', region_name, err);
                });
        });
}


var _ec2 = new AWS.EC2();
var _ec2_per_region = {};

function ec2_call(func_name, params) {
    return Q.nfcall(_ec2[func_name].bind(_ec2), params);
}


function ec2_region_call(region_name, func_name, params) {
    var ec2 = _ec2_per_region[region_name] = _ec2_per_region[region_name] || new AWS.EC2({
        region: region_name
    });
    return Q.nfcall(ec2[func_name].bind(ec2), params);
}


// print object with deep levels
function console_inspect(desc, obj) {
    console.log(desc);
    console.log(util.inspect(obj, {
        depth: null
    }));
}

function print_instances(instances) {
    if (argv.long) {
        console_inspect('Instances:', instances);
    } else {
        _.each(instances, function(instance) {
            console.log('Instance:',
                instance.InstanceId,
                instance.PublicIpAddress,
                instance.State && instance.State.Name || '?');
        });
    }

}

/**
 *
 *
 *
 */
function main() {

    if (!_.isUndefined(argv.scale)) {
        scale_instances(argv.scale)
            .then(function(res) {
                console_inspect('Scale ' + argv.scale + ':', res);
                return describe_instances().then(print_instances);
            })
            .done();
    }

    if (!_.isUndefined(argv.instance)) {
        describe_instance(argv.instance)
            .then(function(instance) {
                console_inspect('Instance ' + argv.instance + ':', instance);
            })
            .done();
    }

    return describe_instances().then(print_instances).done();
}

if (require.main === module) {
    main();
}
