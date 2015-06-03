"use strict";

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var dotenv = require('dotenv');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');
Q.longStackSupport = true;


/**
 *
 * EC2
 *
 * noobaa's ec2 wrapper
 *
 */

module.exports = {
    //General API
    describe_instances: describe_instances,
    describe_instance: describe_instance,
    terminate_instances: terminate_instances,
    import_key_pair_to_region: import_key_pair_to_region,
    print_instances: print_instances,
    create_instance_from_ami: create_instance_from_ami,
    add_instance_name: add_instance_name,
    get_ip_address: get_ip_address,

    //Agents Specific API
    scale_agent_instances: scale_agent_instances,
    add_agent_region_instances: add_agent_region_instances,
    get_agent_ami_image_id: get_agent_ami_image_id,

    //Utility API
    ec2_call: ec2_call,
    ec2_region_call: ec2_region_call,
    ec2_wait_for: ec2_wait_for,
    set_app_name: set_app_name,
};

/*************************************
 *
 * Globals
 *
 *************************************/

/* load aws config from env */
if (!process.env.AWS_ACCESS_KEY_ID) {
    console.log('loading .env file...');
    dotenv.load();
}

// AWS.config.loadFromPath('./env.js');
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION,
});

var KEY_PAIR_PARAMS = {
    KeyName: 'noobaa-demo',
    PublicKeyMaterial: fs.readFileSync(__dirname + '/noobaa-demo.pub')
};


// the heroku app name
var app_name = '';

var _ec2 = new AWS.EC2();
var _ec2_per_region = {};

var _cached_ami_image_id;

/*************************************
 *
 * General API
 *
 *************************************/
/**
 *
 * describe_instances
 *
 * @return instance array with entry per region,
 *      each entry is array of instance info.
 *
 */
function describe_instances(params, filter_tags, verbose) {
    var regions = [];
    var exec_params = {
        verbose: (typeof verbose === 'undefined') ? verbose : false,
        filter_tags: (typeof filter_tags === 'undefined') ? filter_tags : false,
    };


    return foreach_region(function(region) {
            regions.push(region);
            return ec2_region_call(region.RegionName, 'describeInstances', params)
                .then(function(res) {
                    // return a flat array of instances from res.Reservations[].Instances[]
                    var instances = _.flatten(_.map(res.Reservations, 'Instances'));
                    // prepare instance extra fields and filter out irrelevant instances
                    return _.filter(instances, function(instance) {
                        instance.region = region;
                        instance.region_name = region.RegionName;
                        instance.tags_map = _.mapValues(_.indexBy(instance.Tags, 'Key'), 'Value');
                        if (exec_params.filter_tags) {
                            if (instance.tags_map.Name !== argv.tag) {
                                console.log('FILTERED', instance.InstanceId, instance.tags_map.Name);
                                return false;
                            }
                        }
                        return true;
                    });
                }).then(null, function(err) {
                    if (exec_params.verbose) {
                        console.log("Error:", err);
                    }
                    return false;
                });
        })
        .then(function(res) {
            // flatten again for all regions, remove regions without results
            var instances = _.flatten(_.filter(res, function(r) {
                return r !== false;
            }));
            // also put the regions list as a "secret" property of the array
            instances.regions = regions;
            return instances;
        });
}

/**
 *
 * describe_instance
 *
 * @return info of single instance
 *
 */
function describe_instance(instance_id, filter_tags, verbose) {
    var exec_params = {
        verbose: (typeof verbose === 'undefined') ? verbose : false,
        filter_tags: (typeof filter_tags === 'undefined') ? filter_tags : false,
    };

    return describe_instances({
                InstanceIds: [instance_id],
            },
            exec_params.verbose,
            exec_params.filter_tags)
        .then(function(res) {
            return res[0];
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

function print_instances(instances) {
    if (argv.long) {
        console_inspect('Instances:', instances);
    } else {
        _.each(instances, function(instance) {
            console.log('Instance:',
                instance.InstanceId,
                instance.State && instance.State.Name || '[no-state]',
                instance.PublicIpAddress,
                instance.region_name,
                instance.tags_map.Name || '[no-name]',
                '[private ip ' + instance.PrivateIpAddress + ']'
            );
        });
    }

}

/**
 *
 * create_instance_from_ami
 *
 * @return new instance id
 * @return new instance public IP
 */
function create_instance_from_ami(ami_name, region, instance_type, name) {
    return Q.fcall(function() {
            return ec2_region_call(region, 'describeImages', {
                    Filters: [{
                        Name: 'name',
                        Values: [
                            ami_name,
                        ]
                    }]
                })
                .then(function(res) {
                    return res.Images[0].ImageId;
                });
        }).then(function(ami_image) {
            console.log('runInstances of:', ami_name, 'at', region, 'of type', instance_type);
            return ec2_region_call(region, 'runInstances', {
                ImageId: ami_image,
                MaxCount: 1,
                MinCount: 1,
                InstanceType: instance_type,
                BlockDeviceMappings: [{
                    DeviceName: '/dev/sda1',
                    Ebs: {
                        VolumeSize: 40,
                    },
                }],
                KeyName: KEY_PAIR_PARAMS.KeyName,
                SecurityGroups: ['noobaa'],
            });
        })
        .then(function(res) {
            var id = res.Instances[0].InstanceId;
            console.log("Got instanceID", id);
            if (name) {
                add_instance_name(id, name, region);
            }
            return {
                instanceid: id,
                ip: res.Instances[0],
            };
        });
}

function add_instance_name(instid, name, region) {
    console.log('TaggingInstance', instid, 'at', region, ' with\'', name, '\'');
    return Q.fcall(function() {
            return ec2_region_call(region, 'createTags', {
                Resources: [instid],
                Tags: [{
                    Key: 'Name',
                    Value: name
                }]
            });
        })
        .then(null, function(err) {
            console.log('Failed TaggingInstance', err);
        });
}

function get_ip_address(instid) {
    return Q.fcall(function() {
            return describe_instance(instid, false, false);
        })
        .then(function(res) {
            //On pending instance state, still no public IP. Wait.
            if (res.State.Name === 'pending') {
                var params = {
                    InstanceIds: [instid],
                };

                return ec2_wait_for(res.region_name, 'instanceRunning', params)
                    .then(function(data) {
                        if (data) {
                            console.log('Recieved IP', data.NetworkInterfaces[0].Association.PublicIp);
                            return data.NetworkInterfaces[0].Association.PublicIp;
                        } else {
                            throw new Error('ec2_Wait_for InstanceID ' + instid + ' No data returned');
                        }
                    })
                    .then(null, function(error) {
                        throw new Error('Error in get_ip_address ' + instid + ' on ec2_wait_for ' + error);
                    });
            } else if (res.State.Name !== 'running') {
                console.log('Error in get_ip_address InstanceID', instid, 'Not in pending/running state, unexpected');
                throw new Error('InstanceID ' + instid + ' Not in pending/running state');
            }
            return res.NetworkInterfaces[0].Association.PublicIp;
        });
}

/*************************************
 *
 * Agents Specific API
 *
 *************************************/

/**
 *
 * scale_instances
 *
 */
function scale_agent_instances(count, allow_terminate, is_docker_host, number_of_dockers, is_win, filter_region) {

    return describe_instances({
        Filters: [{
            Name: 'instance-state-name',
            Values: ['running', 'pending']
        }]
    }).then(function(instances) {

        var instances_per_region = _.groupBy(instances, 'region_name');
        var region_names = _.pluck(instances.regions, 'RegionName');
        var target_region_count = 0;
        var first_region_extra_count = 0;

        if (filter_region !== '') {
            console.log('Filter and use only region:', filter_region);
            region_names = [filter_region];
        }

        console.log('region_names:', region_names);

        if (count < region_names.length) {
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
            target_region_count = Math.floor(count / region_names.length);
            first_region_extra_count = (count % region_names.length);
            if (target_region_count > 100) {
                target_region_count = 100;
                first_region_extra_count = 0;
                console.log('Cannot scale to over 100 instances per region. will scale to 100');
            }
        }

        console.log('Scale:', target_region_count, 'per region');
        console.log('Scale:', first_region_extra_count, 'extra in first region');

        var new_count = 0;
        return Q.all(_.map(region_names, function(region_name) {
            var instances = instances_per_region[region_name] || [];
            var region_count = 0;
            if (new_count < count) {
                if (first_region_extra_count > 0 && region_name === region_names[0]) {
                    region_count = target_region_count + first_region_extra_count;
                } else {
                    region_count = target_region_count;
                }
                new_count += region_count;
            }

            return scale_region(region_name, region_count, instances, allow_terminate, is_docker_host, number_of_dockers, is_win);
        }));
    });
}

/**
 *
 * add_agent_region_instances
 *
 */
function add_agent_region_instances(region_name, count, is_docker_host, number_of_dockers, is_win) {
    var instance_type = 't2.micro';
    // the run script to send to started instances
    var run_script = fs.readFileSync(__dirname + '/init_agent.sh', 'UTF8');

    var test_instances_counter;

    if (is_docker_host) {
        instance_type = 'm3.2xlarge';
        run_script = fs.readFileSync(__dirname + '/docker_setup.sh', 'utf8');
        //replace 'test' with the correct env name
        test_instances_counter = (run_script.match(/test/g) || []).length;
        var dockers_instances_counter = (run_script.match(/200/g) || []).length;

        if (test_instances_counter !== 1 || dockers_instances_counter !== 1) {
            throw new Error('docker_setup.sh expected to contain default env "test" and default number of dockers - 200');
        }
        run_script = run_script.replace("test", app_name);
        run_script = run_script.replace("200", number_of_dockers);
    } else {
        if (is_win) {
            run_script = fs.readFileSync(__dirname + '/init_agent.bat', 'UTF8');
            instance_type = 'm3.large';
        } else {

            test_instances_counter = (run_script.match(/test/g) || []).length;

            console.log('test_instances_counter', test_instances_counter);
            if (test_instances_counter !== 1) {
                throw new Error('init_agent.sh expected to contain default env "test"', test_instances_counter);
            }
            run_script = run_script.replace("test", app_name);
        }

    }
    //console.log('run ',run_script);


    return Q
        .fcall(get_agent_ami_image_id, region_name, is_win)
        .then(function(ami_image_id) {

            console.log('AddInstance:', region_name, count, ami_image_id);
            return ec2_region_call(region_name, 'runInstances', {
                ImageId: ami_image_id,
                MaxCount: count,
                MinCount: count,
                InstanceType: instance_type,
                // InstanceType: 'm3.medium',
                BlockDeviceMappings: [{
                    DeviceName: '/dev/sda1',
                    Ebs: {
                        VolumeSize: 120,
                    },
                }],
                KeyName: KEY_PAIR_PARAMS.KeyName,
                SecurityGroups: ['ssh_and_http_v2'],
                UserData: new Buffer(run_script).toString('base64'),
            });
        });
}

/**
 *
 * get_agent_ami_image_id
 *
 * @return the image id and save in memory for next calls
 *
 */
function get_agent_ami_image_id(region_name, is_win) {
    // if (_cached_ami_image_id) return _cached_ami_image_id;
    if (is_win) {

        return ec2_region_call(region_name, 'describeImages', {
                Filters: [{
                    Name: 'name',
                    Values: [
                        'Windows_Server-2012-R2_RTM-English-64Bit-Base-2015*',
                    ]
                }]
            })
            .then(function(res) {
                // console.log('res:',res);
                // res = null;
                _cached_ami_image_id = res.Images[0].ImageId;
                return _cached_ami_image_id;
            });
    } else {

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
}

/*************************************
 *
 * Utility API
 *
 *************************************/
function ec2_call(func_name, params) {
    return Q.nfcall(_ec2[func_name].bind(_ec2), params);
}


function ec2_region_call(region_name, func_name, params) {
    var ec2 = _ec2_per_region[region_name] = _ec2_per_region[region_name] || new AWS.EC2({
        region: region_name
    });
    return Q.nfcall(ec2[func_name].bind(ec2), params);
}

//Set the app_name to use
function set_app_name(appname) {
    app_name = appname;
}

function ec2_wait_for(region_name, state_name, params) {
    var ec2 = _ec2_per_region[region_name] = _ec2_per_region[region_name] || new AWS.EC2({
        region: region_name
    });

    return Q.ninvoke(ec2, 'waitFor', state_name, params).then(function(data) {
        if (data) {
            return data.Reservations[0].Instances[0];
        } else {
            console.error("Error while waiting for state", state_name, "at", region_name, "with", params);
            return '';
        }
    });
}



/*************************************
 *
 * Internal
 *
 *************************************/
/**
 *
 * scale_region
 *
 * @param count - the desired new count of instances
 * @param instances - array of existing instances
 *
 */
function scale_region(region_name, count, instances, allow_terminate, is_docker_host, number_of_dockers, is_win) {

    // always make sure the region has the security group and key pair
    return Q
        .fcall(function() {
            return create_security_group(region_name);
        })
        .then(function() {
            return import_key_pair_to_region(region_name);
        })
        .then(function() {

            // need to create
            if (count > instances.length) {
                console.log('ScaleRegion:', region_name, 'has', instances.length,
                    ' +++ adding', count - instances.length);
                return add_agent_region_instances(region_name, count - instances.length, is_docker_host, number_of_dockers, is_win);
            }

            // need to terminate
            if (count < instances.length) {
                if (!allow_terminate) {
                    console.log('ScaleRegion:', region_name, 'has', instances.length,
                        ' ??? should remove', instances.length - count);
                    throw new Error('allow_terminate');
                }
                console.log('ScaleRegion:', region_name, 'has', instances.length,
                    ' --- removing', instances.length - count);
                var death_row = _.slice(instances, 0, instances.length - count);
                console.log('death:', death_row.length);
                var ids = _.pluck(death_row, 'InstanceId');
                return terminate_instances(region_name, ids);
            }

            console.log('ScaleRegion:', region_name, 'has', instances.length, ' ... unchanged');
        })
        .then(null, function(err) {
            console.log('Error while trying to scale region:', region_name, ', has', instances.length, ' error:', err, err.stack);
        });
}

/**
 *
 * create_security_group
 *
 */
function create_security_group(region_name) {
    var ssh_and_http_v2 = 'ssh_and_http_v2';

    // first find if the group exists
    return ec2_region_call(region_name, 'describeSecurityGroups', {
            GroupNames: [ssh_and_http_v2]
        })
        .then(function(group_data) {

            // yeah! exists. return it to check if port rules exists
            // console.log('SecurityGroup: Found on region', region_name);
            return group_data;
        }, function(err) {

            // if failed because of some really bad thing then bail
            if (err.code !== 'InvalidSecurityGroup.NotFound') {
                console.error('SecurityGroup: describe failed', region_name, err);
                throw err;
            }

            // if failed because the group doesn't exists - create it.
            console.log('SecurityGroup: will create for region', region_name);
            return ec2_region_call(region_name, 'createSecurityGroup', {
                    Description: ssh_and_http_v2,
                    GroupName: ssh_and_http_v2
                })
                .then(null, function(err) {
                    console.error('SecurityGroup: create failed', region_name, err);
                    throw err;
                });
        })
        .then(function(group_data) {

            // set the port rules of the group to open ports ssh(22) and nb-http(5050)
            // console.log('SecurityGroup: setting ssh/http rules for group',
            // group_data.GroupId, region_name);
            return ec2_region_call(region_name, 'authorizeSecurityGroupIngress', {
                    GroupId: group_data.GroupId,
                    GroupName: ssh_and_http_v2,
                    IpPermissions: [{
                            FromPort: 22,
                            IpProtocol: 'tcp',
                            ToPort: 22,
                            IpRanges: [{
                                CidrIp: '0.0.0.0/0'
                            }]
                        }, {
                            FromPort: 5050,
                            IpProtocol: 'tcp',
                            ToPort: 5050,
                            IpRanges: [{
                                CidrIp: '0.0.0.0/0'
                            }]
                        },
                        /* more items */
                    ]
                })
                .then(function(data) {
                    console.log('SecurityGroup: Opened ports 22 and 5050');
                }, function(err) {

                    // if failed because the rules exist - it's a good thing
                    if (err.code === 'InvalidPermission.Duplicate') {
                        // console.log('SecurityGroup: Rules exist for region', region_name);
                        return;
                    }
                    console.error('SecurityGroup: authorize failed',
                        region_name, group_data.GroupId, err);
                    throw err;
                });
        });
}

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

// print object with deep levels
function console_inspect(desc, obj) {
    console.log(desc);
    console.log(util.inspect(obj, {
        depth: null
    }));
}
