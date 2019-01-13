/* Copyright (C) 2016 NooBaa */
'use strict';

var _ = require('lodash');
var P = require('../util/promise');
var util = require('util');
var dotenv = require('../util/dotenv');
var argv = require('minimist')(process.argv);
var { google } = require('googleapis');
var compute = google.compute('v1');
var Semaphore = require('../util/semaphore');

// var OAuth2 = google.auth.OAuth2;

//production
//var SERVICE_ACCOUNT_EMAIL = '212693709820-eosjslu4ekqsp95nqnon23n9sfbl4u5b@developer.gserviceaccount.com';
//var SERVICE_ACCOUNT_KEY_FILE = './gcloud.pem';
//openssl pkcs12 -in path.p12 -out newfile.crt.pem -nodes
//pass is notasecret
//test-env
//var SERVICE_ACCOUNT_EMAIL = '476295869076-4b782huoudktl6dtiqp6h44m92ifm6q6@developer.gserviceaccount.com';
//var SERVICE_ACCOUNT_KEY_FILE = './gcloud_test.pem';
//var NooBaaProject = 'noobaa-test-1';
//eran-env
//var SERVICE_ACCOUNT_EMAIL = '577111042235-ettds6vsujjl7toi5s28l0utttol96qf@developer.gserviceaccount.com';
//var SERVICE_ACCOUNT_KEY_FILE = './gcloud_eran.pem';
//var NooBaaProject = 'noobaa-eran-1';
//Generic
/* load aws config from env */

var cloud_context = {};
cloud_context.counter = 0;
cloud_context.sem = new Semaphore(1);
if (!process.env.SERVICE_ACCOUNT_EMAIL) {
    console.log('loading .env file...');
    dotenv.load();
}

var SERVICE_ACCOUNT_EMAIL = '';
var SERVICE_ACCOUNT_KEY_FILE = '';
var agent_conf_arg = '';
var authClient = '';

var router_address = '0.0.0.0';

var NooBaaProject = '';

/**
 *
 * Google Cloud
 *
 * noobaa's Google Cloud wrapper
 *
 */

module.exports = {
    scale_instances: scale_instances,
    describe_instances: describe_instances,
    describe_instance: describe_instance,
    terminate_instances: terminate_instances,
    import_key_pair_to_region: import_key_pair_to_region,
};


// var _gcloud_per_zone = {};
var app_name = '';

// returns a promise for the completion of the loop
function promiseWhile(condition, body) {
    return loop();

    // When the result of calling `condition` is no longer true, we are done.
    // Use `when`, in case `body` does not return a promise.
    // When it completes loop again otherwise, if it fails, reject the
    // done promise
    function loop() {
        return condition() && P.fcall(body).then(loop);
    }
}

/**
 *
 * scale_instances
 *
 */
function import_key_pair_to_region() {
    //Empty function
}

// eslint-disable-next-line max-params
function scale_instances(count, allow_terminate, is_docker_host, number_of_dockers, is_win, filter_region, agent_conf) {

    return describe_instances({
            filter: 'status ne STOPPING '
        }, {
            match: app_name
        }).then(function(instances) {

            cloud_context.counter = instances.length + 1;
            //console.log('full instances',instances);
            var instances_per_zone = _.groupBy(instances, 'zone');

            var zones_names = instances.zones;
            if (_.isUndefined(filter_region)) {
                console.log('No Filters. Zones:', zones_names);
            } else {
                console.log('Filter and use only region:', filter_region);
                zones_names = [filter_region];
            }

            //console.log('instances_per_zone',instances_per_zone);
            var target_zone_count = 0;
            var first_zone_extra_count = 0;
            if (count < zones_names.length) {
                // if number of instances is smaller than the number of zones,
                // we will add one instance per zone until we have enough instances.
                if (count === 0) {
                    target_zone_count = 0;
                } else {
                    target_zone_count = 1;
                }
            } else {
                // divide instances equally per zone.
                // the first zone will get the redundant instances
                target_zone_count = Math.floor(count / zones_names.length);

                first_zone_extra_count = (count % zones_names.length);

                if (target_zone_count > 400) {
                    target_zone_count = 400;
                    first_zone_extra_count = 0;
                    console.log('Cannot scale to over 400 instances per zone. will scale to 400');
                }
            }
            //console.log('region_names:', zones_names);


            console.log('Scale:', target_zone_count, 'per zone');
            console.log('Scale:', first_zone_extra_count, 'extra in first zone');

            var new_count = 0;
            return P.all(_.map(zones_names, function(zone_name) {
                //console.log('aa');
                var zone_instances = instances_per_zone['https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + zone_name] || [];
                var zone_count = 0;
                if (new_count < count) {
                    if (first_zone_extra_count > 0 && zone_name === zones_names[0]) {
                        zone_count = target_zone_count + first_zone_extra_count;
                    } else {
                        zone_count = target_zone_count;
                    }
                    new_count += zone_count;
                }

                return scale_region(
                    zone_name, zone_count, zone_instances, allow_terminate,
                    is_docker_host, number_of_dockers, is_win, agent_conf
                );
            }));
        })
        .catch(function(err) {
            console.log('####');
            console.log('#### Cannot scale. Reason:', err.message, err.stack);
            console.log('####');

        });
}

/**
 *
 *
 */

function get_network_counter() {

    return P.fcall(function() {
        if (cloud_context) {
            return cloud_context.sem.surround(function() {
                console.log('Current network counter is', cloud_context.counter);
                cloud_context.counter += 1;
                return cloud_context.counter;
            });

        }
    });

}


/**
 *
 * get_zones
 *
 */
function get_zones(func) {
    //console.log('get_zones1');

    return P.nfcall(compute.zones.list, {
            project: NooBaaProject,
            auth: authClient
        }).then(func)
        .catch(function(err) {
            console.log('get_zones err:', err);
            if (err.errors > 0 && err.errors[0].reason === 'notFound') {
                console.log('Setup issue. Make sure you have the right credentials (https://console.developers.google.com/project/<project_name>/apiui/credential)', err);
            } else {
                console.log('err', err);
                throw err;
            }
        });
}



/**
 *
 * foreach_zone
 *
 * @param func is function(region) that can return a promise.
 * @return promise for array of results per region func.
 *
 */
function foreach_zone(func) {
    return get_zones(function(res) {
        return P.all(_.map(res.items, func));
    }).catch(function(err) {
        console.log('err zone:', err);
    });
}


// eslint-disable-next-line max-params
function scale_region(region_name, count, instances, allow_terminate, is_docker_host, number_of_dockers, is_win, agent_conf) {
    //console.log('scale region from ' + instances.length + ' to count ' + count);
    // need to create
    if (count > instances.length) {
        console.log('ScaleRegion:', region_name, 'has', instances.length,
            ' +++ adding', count - instances.length);
        return add_region_instances(
                region_name, count - instances.length, is_docker_host, number_of_dockers,
                is_win, agent_conf, instanceCreationProgressHandler)
            //once the instances are up, we can add disk dependency
            .then(instance_post_creation_handler,
                instance_creation_error_handler);
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
        var ids = _.map(death_row, 'name');
        console.log('death row (ids):', ids);
        //in this case, the id is the instance name.
        return terminate_instances(region_name, ids);
    }

    console.log('ScaleRegion:', region_name, 'has', instances.length, ' ... unchanged');
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


// print object with deep levels
function console_inspect(desc, obj) {
    console.log(desc);
    console.log(util.inspect(obj, { depth: null }));
}

function print_instances(instances) {

    if (argv.long) {
        console_inspect('Instances:', instances);
    } else {
        console.log('Total of ', instances.length + ' instances');
        _.each(instances, function(current_instance) {
            //console.log('current_instance:'+current_instance);
            var pieces_array = current_instance.zone.split('/');
            var zone_name = pieces_array[pieces_array.length - 1];
            current_instance.tags_map = _.mapValues(_.keyBy(current_instance.metadata.items, 'key'), 'value');

            console.log('Instance:',
                current_instance.id,
                current_instance.status || '[no-state]',
                'tag_name:', current_instance.tags_map.Name || '<NA>',
                current_instance.networkInterfaces[0].accessConfigs[0].natIP,
                zone_name,
                current_instance.Name || '',
                '[private ip ' + current_instance.networkInterfaces[0].networkIP + ']',
                '[public ip ' + current_instance.networkInterfaces[0].accessConfigs[0].natIP + ']'
            );

        });
    }

}


function instance_post_creation_handler(instance_full_details_list, callback) {


    return P.all(_.map(instance_full_details_list, function(instance_full_details) {
        var pieces_array = instance_full_details.zone.split('/');

        var zoneName = pieces_array[pieces_array.length - 1];

        var auto_delete_disk_params = {
            instance: instance_full_details.name,
            project: NooBaaProject,
            zone: zoneName,
            auth: authClient,
            autoDelete: true,
            deviceName: instance_full_details.disks[0].deviceName,
        };

        compute.instances.setDiskAutoDelete(auto_delete_disk_params, function(err, auto_delete_information) {
            if (err) {
                console.log('Disk auto deletion err:' + JSON.stringify(err));
            } else {
                console.log('Disk auto deletion:' + JSON.stringify(instance_full_details.name));
            }
        });
    }));
}

function instance_creation_error_handler(operationResourceInput, callback) {
    console.log('Error while CREATION' + JSON.stringify(operationResourceInput));
}

function instanceCreationProgressHandler(operationResourceInput, callback) {
    //console.log('Progress of operation:' + JSON.stringify(operationResourceInput.name));
}

/**
 *
 * describe_instances
 *
 * @return instance array with entry per region,
 *      each entry is array of instance info.
 *
 */
function describe_instances(params, filter) {
    var zones = [];
    var created_instance_data = [];

    return foreach_zone(function(current_zone) {
            zones.push(current_zone.name);
            var instancesListParams = {
                auth: authClient,
                project: NooBaaProject,
                zone: current_zone.name,
            };
            if (params && params.filter) {
                instancesListParams.filter = params.filter;
            }

            return P.nfcall(compute.instances.list, instancesListParams)
                .then(function(instances_list_results) {
                    if (instances_list_results.items) {
                        // var number_of_instances_in_zone = instances_list_results[0].items.length;
                        created_instance_data = created_instance_data.concat(instances_list_results.items);
                    }

                })
                .catch(function(error) {
                    console.log('ERROR1:' + JSON.stringify(error) + ':' + error.stack);
                });
        }).then(function(err, data) {
            var instances = _.flatten(created_instance_data);
            if (err) {
                console.warn('got err', err);
            }
            // also put the regions list as a "secret" property of the array
            return _.filter(instances, function(instance) {
                instance.tags_map = _.mapValues(_.keyBy(instance.metadata.items, 'key'), 'value');

                //console.log('filter instance:',instance.name,instance.tags_map.Name,instances.zones);
                if (typeof filter !== 'undefined') {
                    if (filter.filter_tags &&
                        (typeof instance.tags_map.Name !== 'undefined')) {
                        if ((instance.tags_map.Name.indexOf(filter.filter_tags) !== -1) ||
                            instance.tags_map.Name !== argv.tag) {
                            console.log('FILTERED exclude', instance.name, instance.tags_map.Name);
                            return false;
                        }
                    } else if (filter.match &&
                        (typeof instance.tags_map.Name !== 'undefined')) {
                        if (instance.tags_map.Name.indexOf(filter.match) === -1) {
                            console.log('FILTERED match', instance.name, instance.tags_map.Name);
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
        .then(function(instances) {
            instances.zones = zones;
            return instances;
        })
        .catch(
            function(error) {
                if (error && error.errors && error.errors[0].reason === 'notFound') {
                    console.log('Setup issue. Make sure you have the right credentials (https://console.developers.google.com/project/<project_name>/apiui/credential)', error);
                    throw error;
                } else {
                    console.log('ERROR2:' + JSON.stringify(error) + ' ' + error.stack);
                }

            }
        );
}

/**
 *
 * getInstanceDataPerInstanceId - unused..
 *
 *
function getInstanceDataPerInstanceId(instanceId) {
    // var instances_per_zone = [];
    var index = 0;
    return compute.zones.list({
        project: NooBaaProject,
        auth: authClient
    }.then(function(zones_list) {
        return P.all(_.map(zones_list, function(zone_name) {
            // var instances = instances_per_zone[zone_name] || [];
            return index < zones_list.items.length;
        }, function() {

            var instanceInformationParams = {
                instance: instanceId,
                zone: zones_list.items[index].name,
                project: NooBaaProject,
                auth: authClient
            };

            compute.instances.get(instanceInformationParams, function(err, informationResult) {
                if (err) {} else {
                    return informationResult;
                }

            });

            index++;
            return P.delay(500); // delay, otherwise error from google
        }));

    }));
}
*/

/**
 *
 * add_region_instances
 *
 */
// eslint-disable-next-line max-params
function add_region_instances(region_name, count, is_docker_host, number_of_dockers, is_win, agent_conf, progress_func) {
    var deferred = P.defer();
    var instancesDetails = [];
    console.log('adding to region ' + region_name + ' ' + count + ' instances', agent_conf);
    var index = 0;
    promiseWhile(function() {
            return index < count;
        }, function() {

            return P.fcall(function() {
                    return get_network_counter();

                })
                .then(function(network_counter) {
                    var noobaa_env_name = app_name;
                    var machine_type = 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + region_name + '/machineTypes/n1-standard-1';
                    var startup_script = 'http://noobaa-download.s3.amazonaws.com/init_agent.sh';
                    var source_image = 'https://www.googleapis.com/compute/v1/projects/centos-cloud/global/images/centos-6-v20160803';
                    var disk_size = 100;

                    if (is_docker_host) {
                        startup_script = 'http://noobaa-download.s3.amazonaws.com/docker_setup.sh';
                        machine_type = 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + region_name + '/machineTypes/n1-highmem-8';
                    } else if (is_win) {
                        disk_size = 50;
                        startup_script = 'http://noobaa-download.s3.amazonaws.com/init_agent.bat';
                        machine_type = 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + region_name + '/machineTypes/n1-highcpu-2';
                        source_image = 'https://www.googleapis.com/compute/v1/projects/windows-cloud/global/images/windows-server-2012-r2-dc-v20150511';
                    }
                    if (_.isUndefined(number_of_dockers)) {
                        number_of_dockers = 0;
                    }
                    var instance_name = '';
                    if (router_address === "0.0.0.0" && is_docker_host) {
                        machine_type = 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + region_name + '/machineTypes/n1-highcpu-2';
                        instance_name = 'router-for-' + app_name.replace(/\./g, "-");
                        disk_size = 50;
                    } else {
                        instance_name = 'agent-for-' + app_name.replace(/\./g, "-");
                    }
                    console.log('env:', noobaa_env_name, NooBaaProject);
                    console.log('script:', startup_script);
                    console.log('number_of_dockers', number_of_dockers);
                    console.log('routing:', cloud_context.counter, router_address);


                    var instanceResource = {

                        project: NooBaaProject,
                        auth: authClient,
                        zone: region_name,
                        //name: NooBaaProject + region_name + (new Date().getTime()),
                        name: instance_name,
                        resource: {
                            zone: region_name,
                            name: instance_name + '-' + Date.now().toString(36),
                            machineType: machine_type,
                            disks: [{
                                initializeParams: {
                                    diskSizeGb: disk_size,
                                    //sourceImage:'https://www.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/ubuntu-trusty-14.04-amd64-server-20140927'
                                    sourceImage: source_image
                                },
                                boot: true
                            }],
                            tags: {
                                items: [
                                    'http-server'
                                ]
                            },
                            metadata: {
                                items: [{
                                    key: 'startup-script-url',
                                    //production
                                    value: startup_script
                                    //value: 'https://s3.amazonaws.com/elasticbeanstalk-us-east-1-628038730422/setupgc.sh'
                                }, {
                                    key: 'windows-startup-script-url',
                                    value: startup_script
                                }, {
                                    key: 'sshKeys',
                                    value: 'ubuntu:ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCGk9U7fEXopJnBL1V4rXRzU580GRmUQVyivycKtUPplfjY3iIEU/DodqCCvn8Gb3rckVr7qd+haSE43IhNsB/zH9gGowUydTs3VwCHQT2pkziisr50EjQ0c6eBkcN5nWGZEPUGe4tGSQUR4agstJPyc3YDLJ96mC0ZOZVPtY+9tBUW0JsKqe45oLgCphSTuRP4cR4kiCv7HIzGLZd/ib6NgzlnLJqGBE74zJo0tgVv33Ixqdx8b0TyktNkGhYyjzweujEmkDX4/wVdX/qyWENDWWTb0D3jCAVgCyJBiuDHvtk0ehmcdYNucp0GuNTlO0Ld0NNsOjjAY9Au52lppYM1 ubuntu\n'
                                }, {
                                    key: 'dockers',
                                    value: number_of_dockers
                                }, {
                                    key: 'agent_conf',
                                    value: agent_conf
                                }, {
                                    key: 'env',
                                    value: noobaa_env_name
                                }, {
                                    key: 'network',
                                    value: network_counter
                                }, {
                                    key: 'router',
                                    value: router_address
                                }, {
                                    key: 'Name',
                                    value: 'Agent_For_' + app_name
                                }]
                            },
                            networkInterfaces: [{
                                name: 'eth0',
                                network: 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/global/networks/default',
                                accessConfigs: [{
                                    kind: 'compute#accessConfig',
                                    name: 'external-nat',
                                    type: 'ONE_TO_ONE_NAT'
                                }]
                            }]
                        },

                    };
                    console.log('New instance name: in region:' + region_name, instanceResource.resource.tags);
                    return P.nfcall(compute.instances.insert, instanceResource)
                        .then(function(instanceInformation) {
                            var pieces_array = instanceInformation.targetLink.split('/');
                            var instanceName = pieces_array[pieces_array.length - 1];
                            console.log('New instance name:' + JSON.stringify(instanceName));

                            //waiting until the instance is running.
                            //Disk dependecy can be added only after the instance is up and running.
                            var interval = setInterval(function() {
                                var operationsParams = {
                                    project: NooBaaProject,
                                    zone: instanceResource.zone,
                                    operation: instanceInformation.name,
                                    auth: authClient,
                                    instanceName: instanceName
                                };

                                return P.nfcall(compute.zoneOperations.get, operationsParams)
                                    .then(function(operationResource) {
                                        progress_func(operationResource);

                                        if (operationResource.status === 'DONE') {
                                            console.log('Instance ' + instanceName +
                                                '::: is up and started installation ' + JSON.stringify(operationResource.status));
                                            var instanceDetailedInformationParams = {
                                                instance: operationsParams.instanceName,
                                                zone: operationsParams.zone,
                                                project: NooBaaProject,
                                                auth: authClient,

                                            };
                                            return P.nfcall(compute.instances.get, instanceDetailedInformationParams)
                                                .then(function(instanceDetails) {
                                                    console.log('instanceDetails up:' + instanceDetails.name);
                                                    instancesDetails.push(instanceDetails);
                                                    if (instancesDetails.length === count) {
                                                        deferred.resolve(instancesDetails);
                                                    }
                                                    clearInterval(interval);
                                                })
                                                .then(null, function(err) {
                                                    console.log('Instance get details err (2):', err);
                                                });
                                        }


                                    })
                                    .catch(function(err) {
                                        console.log('Zone Operation err(1):', err);
                                        console.log('Zone Operation err:' + JSON.stringify(err) + JSON.stringify(operationsParams));
                                        deferred.resolve(null);
                                        clearInterval(interval);
                                    });

                            }, 8000);
                            index += 1;
                            return P.delay(1000); // arbitrary async
                        });

                });



        }).then(function() {
            console.log('done creating ' + count + ' new instances in zone ' + region_name);
            return deferred.promise;
        })
        .catch(function(error) {
            console.log('ERROR4:' + JSON.stringify(error) + ' ' + error.stack);
        });
    return deferred.promise;
}

/**
 *
 * terminate_instance
 *
 * @param instance_ids array of ids.
 */

function terminate_instances(region_name, instance_ids) {
    _.each(instance_ids, function(current_instance) {
        console.log('Terminate ' + current_instance + ' in zone ' + region_name);
        var terminationParams = {
            instance: current_instance,
            project: NooBaaProject,
            zone: region_name,
            auth: authClient
        };
        return P.nfcall(compute.instances.delete, terminationParams)
            .then(function(terminationResults) {
                console.log('Termination of instance ' + current_instance + ' done');

            })
            .catch(function(err) {
                console.log('Termination of instance ' + current_instance + ' failed due to error:' + JSON.stringify(err) + err.stack);
                throw err;
            });
    });

}




function init(callback) {
    if (authClient.gapi) return;
    console.log('waiting for auth');
    setTimeout(function() {
        authClient.authorize(function(err, token) {
            console.log('Authenticated!', token);
            if (err) {
                console.warn('err', err);
            }
            callback(token);
        });
    }, 2000);
}

function main() {
    console.log('before init');
    if (_.isUndefined(argv.agent_conf)) {

        console.error('\n\n******************************************');
        console.error('Please provide --agent_conf (base64, copy from UI)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --agent_conf');
    } else {
        agent_conf_arg = argv.agent_conf;
    }
    if (_.isUndefined(argv.app)) {

        console.error('\n\n******************************************');
        console.error('Please provide --app (used to be heroku app name.');
        console.error('currently just tag for reference - use the metadata server address)');
        console.error('******************************************\n\n');
        throw new Error('MISSING --app');
    } else {
        app_name = argv.app;
        SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
        SERVICE_ACCOUNT_KEY_FILE = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;
        NooBaaProject = process.env.GOOGLE_PROJECT_NAME;
        authClient = new google.auth.JWT(
            SERVICE_ACCOUNT_EMAIL,
            SERVICE_ACCOUNT_KEY_FILE,
            null, ['https://www.googleapis.com/auth/compute']);

        //console.log('Noobaa Project: ',NooBaaProject," file:",SERVICE_ACCOUNT_KEY_FILE," auth:",authClient);


    }
    if (_.isUndefined(SERVICE_ACCOUNT_EMAIL)) {
        console.error('\n\n****************************************************');
        console.error('You must provide google cloud env details in .env:');
        console.error('SERVICE_ACCOUNT_EMAIL SERVICE_ACCOUNT_KEY_FILE NOOBAA_PROJECT_NAME');
        console.error('****************************************************\n\n');
        return;
    }

    init(function(data) {
        var is_docker_host = false;


        if (!_.isUndefined(argv.dockers)) {
            is_docker_host = true;
            if (_.isUndefined(argv.router)) {
                console.error('\n\n********************************************************************************************************');
                console.error('You must provide weave routing machine (--router)');
                console.error('In order to create this router, use (without any additional parameters)"gcloud --set_router --region <X>"');
                console.error('********************************************************************************************************\n\n');
                return;
            } else {
                router_address = argv.router;
                cloud_context.counter = 2;
            }
            console.log('starting ' + argv.dockers + ' dockers on each host');

        }

        if (!_.isUndefined(argv.set_router)) {
            if (_.isUndefined(argv.region)) {
                console.error('\n\n****************************************************');
                console.error('You must provide region weave routing machine (--region)');
                console.error('In order to create this router, use "gcloud --set_router --region xxxx"');
                console.error('****************************************************\n\n');
            } else {
                //add router
                cloud_context.counter = 0;
                add_region_instances(argv.region, 1, true, 0, false, agent_conf_arg);
            }
        } else if (!_.isUndefined(argv.scale)) {
            // add a --term flag to allow removing nodes
            //gcloud.js --app noobaa-test-1 --scale 20 --is_win
            scale_instances(argv.scale, argv.term, is_docker_host, argv.dockers, argv.is_win, argv.region, agent_conf_arg)
                .then(function(res) {
                    console.log('Scale: completed to ' + argv.scale);
                    return describe_instances().then(print_instances);
                }, function(err) {
                    if (err.message === 'allow_terminate') {
                        console.error('\n\n******************************************');
                        console.error('SCALE DOWN REJECTED');
                        console.error('Use --term flag to allow terminating nodes');
                        console.error('******************************************\n\n');
                        return;
                    }
                    throw err;
                });
        } else if (_.isUndefined(argv.instance)) {
            //console.log('desc instances');
            describe_instances().then(print_instances);
        } else {
            describe_instance(argv.instance)
                .then(function(instance) {
                    console_inspect('Instance ' + argv.instance + ':', instance);
                });
        }
    });

}

if (require.main === module) {
    main();
}
