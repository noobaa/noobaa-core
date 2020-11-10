/* Copyright (C) 2016 NooBaa */
"use strict";

var _ = require('lodash');
var P = require('../util/promise');
var fs = require('fs');
var path = require('path');
var util = require('util');
var dotenv = require('../util/dotenv');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');
var moment = require('moment');

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

    //S3 API, these all work and assume Demo system exists
    verify_demo_system: verify_demo_system,
    put_object: put_object,
    get_object: get_object,

    //Agents Specific API
    scale_agent_instances: scale_agent_instances,
    add_agent_region_instances: add_agent_region_instances,
    get_agent_ami_image_id: get_agent_ami_image_id,

    //Utility API
    ec2_call: ec2_call,
    ec2_region_call: ec2_region_call,
    ec2_wait_for: ec2_wait_for,
    set_app_name: set_app_name,
    console_inspect: console_inspect,
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


// the heroku app name
var app_name = '';

var _ec2 = new AWS.EC2();
var _ec2_per_region = {};

var _cached_ami_image_id;

load_aws_config_env();


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
function describe_instances(params, filter, verbose) {
    var regions = [];
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
                        instance.tags_map = _.mapValues(_.keyBy(instance.Tags, 'Key'), 'Value');
                        if (typeof filter !== 'undefined') {
                            if (filter.filter_tags &&
                                (typeof instance.tags_map.Name !== 'undefined')) {
                                if ((instance.tags_map.Name.indexOf(filter.filter_tags) !== -1) ||
                                    instance.tags_map.Name !== argv.tag) {
                                    if (verbose) {
                                        console.log('FILTERED exclude', instance.InstanceId, instance.tags_map.Name);
                                    }
                                    return false;
                                }
                            } else if (filter.match &&
                                (typeof instance.tags_map.Name !== 'undefined')) {
                                if (instance.tags_map.Name.indexOf(filter.match) === -1) {
                                    if (verbose) {
                                        console.log('FILTERED match', instance.InstanceId, instance.tags_map.Name);
                                    }
                                    return false;
                                }
                            }
                            if (typeof instance.tags_map.Name === 'undefined') {
                                //assume empty tagged instances are manual and always ignore them
                                return false;
                            }
                        }
                        return true;
                    });
                })
                .then(null, function(err) {
                    if (verbose) {
                        console.log('Error:', err);
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
    return describe_instances({
                InstanceIds: [instance_id],
            },
            filter_tags,
            verbose)
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
    const KEY_PAIR_PARAMS = {
        KeyName: 'noobaa-demo',
        PublicKeyMaterial: fs.readFileSync(path.join(__dirname, 'noobaa-demo.pub'))
    };
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
                (instance.State && instance.State.Name) || '[no-state]',
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
    const KEY_PAIR_PARAMS = {
        KeyName: 'noobaa-demo',
        PublicKeyMaterial: fs.readFileSync(path.join(__dirname, 'noobaa-demo.pub'))
    };
    return P.fcall(function() {
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
            console.log('Got instanceID', id);
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
    return P.fcall(function() {
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
    return P.fcall(function() {
            return describe_instance(instid);
        })
        .then(function(res) {
            //On pending instance state, still no public IP. Wait.
            if (res.State.Name === 'pending') {
                var params = {
                    InstanceIds: [instid],
                };

                console.log('Machine in', res.State, 'state, waiting for instanceStatusOk');
                return ec2_wait_for(res.region_name, 'instanceStatusOk', params)
                    .then(function() {
                        return P.fcall(function() {
                                return describe_instance(instid);
                            })
                            .then(function(res2) {
                                console.log('Recieved IP', res2.PublicIpAddress);
                                return res2.PublicIpAddress;
                            });
                    })
                    .then(null, function(error) {
                        throw new Error('Error in get_ip_address ' + instid + ' on ec2_wait_for ' + error);
                    });
            } else if (res.State.Name !== 'running') {
                console.log('Error in get_ip_address InstanceID', instid, 'Not in pending/running state, unexpected');
                throw new Error('InstanceID ' + instid + ' Not in pending/running state');
            }
            return res.PublicIpAddress;
        });
}

/*************************************
 *
 * S3 API
 * Assumes Demo system exists and work on it
 *
 *************************************/

function verify_demo_system(ip) {
    load_demo_config_env(); //switch to Demo system

    var rest_endpoint = 'http://' + ip + ':80/';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    return P.ninvoke(s3bucket, 'listObjects', {
            Bucket: 'first.bucket'
        })
        .then(function(data) {
            console.log('Demo system exists');
            load_aws_config_env(); //back to EC2/S3

        })
        .then(null, function(error) {
            load_aws_config_env(); //back to EC2/S3
            throw new Error('No Demo System, please create one for ' + rest_endpoint + ' bucket:' + s3bucket + ',error:' + error);
        });
}

function put_object(ip, source, bucket, key, timeout, throw_on_error) {
    load_demo_config_env(); //switch to Demo system

    var rest_endpoint = 'http://' + ip + ':80';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    //if no source file supplied, use a log from the machine
    source = source || '/var/log/appstore.log';
    bucket = bucket || 'first.bucket';
    key = key || 'ec2_wrapper_test_upgrade.dat';

    var params = {
        Bucket: bucket,
        Key: key,
        Body: fs.createReadStream(source),
    };
    console.log('about to upload object', params);
    var start_ts = Date.now();
    return P.ninvoke(s3bucket, 'upload', params)
        .then(function(res) {
            console.log('Uploaded object took', (Date.now() - start_ts) / 1000, 'seconds, result', res);
            load_aws_config_env(); //back to EC2/S3

        }, function(err) {
            var wait_limit_in_sec = timeout || 1200;
            var start_moment = moment();
            var wait_for_agents = (err.statusCode === 500 || err.statusCode === 403);
            console.log('failed to upload object in loop', err.statusCode, wait_for_agents);
            return P.pwhile(
                function() {
                    return wait_for_agents;
                },
                function() {
                    return P.fcall(function() {
                        //switch to Demo system
                        return load_demo_config_env();
                    }).then(function() {
                        params.Body = fs.createReadStream(source);
                        start_ts = Date.now();
                        return P.ninvoke(s3bucket, 'upload', params)
                            .then(function(res) {
                                console.log('Uploaded object took', (Date.now() - start_ts) / 1000, 'seconds, result', res);
                                load_aws_config_env(); //back to EC2/S3
                                wait_for_agents = false;

                            }, function(err2) {
                                console.log('failed to upload. Will wait 10 seconds and retry. err', err2.statusCode);
                                var curr_time = moment();
                                if (curr_time.subtract(wait_limit_in_sec, 'second') > start_moment) {
                                    console.error('failed to upload. cannot wait any more', err2.statusCode);
                                    load_aws_config_env(); //back to EC2/S3
                                    wait_for_agents = false;
                                    if (throw_on_error) {
                                        throw new Error(err2);
                                    }
                                } else {
                                    return P.delay(10000);
                                }
                            });
                    });
                });
        });
}

function get_object(ip, obj_path) {
    load_demo_config_env(); //switch to Demo system

    var rest_endpoint = 'http://' + ip + ':80/';
    var s3bucket = new AWS.S3({
        endpoint: rest_endpoint,
        s3ForcePathStyle: true,
        sslEnabled: false,
    });

    var params = {
        Bucket: 'first.bucket',
        Key: 'ec2_wrapper_test_upgrade.dat',
    };

    var file = obj_path && fs.createWriteStream(obj_path);

    var start_ts = Date.now();
    console.log('about to download object');
    return P.fcall(function() {
            if (obj_path) {
                return s3bucket.getObject(params).createReadStream()
                    .pipe(file);
            } else {
                return s3bucket.getObject(params).createWriteStream();
            }
        })
        .then(function() {
            console.log('Download object took', (Date.now() - start_ts) / 1000, 'seconds');
            load_aws_config_env(); //back to EC2/S3

        })
        .then(null, function(err) {
            load_aws_config_env(); //back to EC2/S3
            throw new Error('Error in download ' + err);
        });
}

/*************************************
 *
 * Agents Specific API
 *
 *************************************/

/**
 *
 * scale_agent_instances
 *
 */
// eslint-disable-next-line max-params
function scale_agent_instances(count, allow_terminate, is_docker_host, number_of_dockers, is_win, filter_region, agent_conf) {
    return describe_instances({
        Filters: [{
            Name: 'instance-state-name',
            Values: ['running', 'pending']
        }],
    }, {
        match: app_name,
    }).then(function(instances) {
        var instances_per_region = _.groupBy(instances, 'region_name');
        var region_names = _.map(instances.regions, 'RegionName');
        var target_region_count = 0;
        var first_region_extra_count = 0;

        if (filter_region !== '') {
            console.log('Filter and use only region:', filter_region);
            region_names = [filter_region];
        }

        console.log('region_names:', region_names, 'count:', count);

        if (count < region_names.length) {
            // if number of instances is smallser than the number of regions,
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
        return P.all(_.map(region_names, function(region_name) {
            var region_instances = instances_per_region[region_name] || [];
            var region_count = 0;
            if (new_count < count) {
                if (first_region_extra_count > 0 && region_name === region_names[0]) {
                    region_count = target_region_count + first_region_extra_count;
                } else {
                    region_count = target_region_count;
                }
                new_count += region_count;
            }
            return scale_region(region_name, region_count, region_instances, allow_terminate,
                is_docker_host, number_of_dockers, is_win, agent_conf);
        }));
    });
}

/**
 *
 * add_agent_region_instances
 *
 */
function add_agent_region_instances(region_name, count, is_docker_host, number_of_dockers, is_win, agent_conf) {
    var instance_type = 'c3.large';
    // the run script to send to started instances
    var run_script = fs.readFileSync(path.join(__dirname, 'init_agent.sh'), 'UTF8');

    var test_instances_counter;

    if (is_docker_host) {
        instance_type = 'm3.2xlarge';
        run_script = fs.readFileSync(path.join(__dirname, 'docker_setup.sh'), 'utf8');
        //replace 'test' with the correct env name
        test_instances_counter = (run_script.match(/test/g) || []).length;
        var dockers_instances_counter = (run_script.match(/200/g) || []).length;

        if (test_instances_counter !== 1 || dockers_instances_counter !== 1) {
            throw new Error('docker_setup.sh expected to contain default env "test" and default number of dockers - 200');
        }
        run_script = run_script.replace('<agent_conf>', agent_conf);
        run_script = run_script.replace('test', app_name);
        run_script = run_script.replace('200', number_of_dockers);
    } else if (is_win) {
        run_script = fs.readFileSync(path.join(__dirname, 'init_agent.bat'), 'UTF8');
        run_script = "<script>" + run_script + "</script>";
        run_script = run_script.replace('$env_name', app_name);
        run_script = run_script.replace('$agent_conf', agent_conf);
        instance_type = 'c3.large';
    } else {
        run_script = run_script.replace('$env_name', app_name);
        run_script = run_script.replace('$agent_conf', agent_conf);
        run_script = run_script.replace('$network', 1);
        run_script = run_script.replace('$router', '0.0.0.0');
        console.log('script:', run_script);
    }


    const KEY_PAIR_PARAMS = {
        KeyName: 'noobaa-demo',
        PublicKeyMaterial: fs.readFileSync(path.join(__dirname, 'noobaa-demo.pub'))
    };

    return P.fcall(get_agent_ami_image_id, region_name, is_win)
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
                    UserData: Buffer.from(run_script).toString('base64'),
                })
                .then(function(res) { //Tag Instances
                    return P.all(_.map(res.Instances, function(instance) {
                        return P.fcall(function() {
                            return add_instance_name(instance.InstanceId, 'Agent_For_' + app_name, region_name);
                        });
                    }));
                })
                .then(null, function(err) {
                    throw new Error('Error on AddInstance at ' + region_name + ' #' + count + ' of ' + ami_image_id + ' ' + err);
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
    return _ec2[func_name](params).promise();
}


function ec2_region_call(region_name, func_name, params) {
    var ec2 = _ec2_per_region[region_name] || new AWS.EC2({
        region: region_name
    });
    _ec2_per_region[region_name] = ec2;
    return ec2[func_name](params).promise();
}

//Set the app_name to use
function set_app_name(appname) {
    app_name = appname;
}

function ec2_wait_for(region_name, state_name, params) {
    var ec2 = _ec2_per_region[region_name] || new AWS.EC2({
        region: region_name
    });
    _ec2_per_region[region_name] = ec2;

    return P.ninvoke(ec2, 'waitFor', state_name, params).then(function(data) {
        if (!data) {
            console.error('Error while waiting for state', state_name, 'at', region_name, 'with', params);
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
// eslint-disable-next-line max-params
function scale_region(region_name, count, instances, allow_terminate, is_docker_host, number_of_dockers, is_win, agent_conf) {
    // always make sure the region has the security group and key pair
    return P.fcall(function() {
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
                return add_agent_region_instances(region_name, count - instances.length, is_docker_host,
                    number_of_dockers, is_win, agent_conf);
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
                var ids = _.map(death_row, 'InstanceId');
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
                .then(null, function(err2) {
                    console.error('SecurityGroup: create failed', region_name, err2);
                    throw err2;
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
                        // more items
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
            return P.all(_.map(res.Regions, func));
        });
}

// print object with deep levels
function console_inspect(desc, obj) {
    console.log(desc);
    console.log(util.inspect(obj, { depth: null }));
}

function load_aws_config_env() {
    // AWS.config.loadFromPath('./env.js');
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
    });
}

function load_demo_config_env() {
    AWS.config.update({
        accessKeyId: '123',
        secretAccessKey: 'abc',
        Bucket: 'first.bucket'
    });
}
