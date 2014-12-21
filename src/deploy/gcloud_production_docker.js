'use strict';

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var util = require('util');
var async = require('async');
var dotenv = require('dotenv');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');
var google = require('googleapis');
var compute = google.compute('v1');
var OAuth2 = google.auth.OAuth2;
Q.longStackSupport = true;

//production
//var SERVICE_ACCOUNT_EMAIL = '212693709820-eosjslu4ekqsp95nqnon23n9sfbl4u5b@developer.gserviceaccount.com';
//var SERVICE_ACCOUNT_KEY_FILE = './gcloud.pem';
//openssl pkcs12 -in path.p12 -out newfile.crt.pem -nodes
//pass is notasecret
var SERVICE_ACCOUNT_EMAIL = '476295869076-4b782huoudktl6dtiqp6h44m92ifm6q6@developer.gserviceaccount.com';
var SERVICE_ACCOUNT_KEY_FILE = './gcloud_test.pem';
var authClient = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    SERVICE_ACCOUNT_KEY_FILE,
    null, ['https://www.googleapis.com/auth/compute']);

var NooBaaProject = 'noobaa-test-1';

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


var _gcloud_per_zone = {};

// // returns a promise for the completion of the loop
function promiseWhile(condition, body) {
    var done = Q.defer();

    function loop() {
        // When the result of calling `condition` is no longer true, we are
        // done.
        if (!condition()) return done.resolve();
        // Use `when`, in case `body` does not return a promise.
        // When it completes loop again otherwise, if it fails, reject the
        // done promise
        Q.when(body(), loop, done.reject);
    }

    // Start running the loop in the next tick so that this function is
    // completely async. It would be unexpected if `body` was called
    // synchronously the first time.
    Q.nextTick(loop);

    // The promise
    return done.promise;
}

/**
 *
 * scale_instances
 *
 */
function import_key_pair_to_region() {

}

function scale_instances(count, allow_terminate) {

    return describe_instances({
        filter: 'status ne STOPPING'
    }).then(function(instances) {
        //console.log('full instances',instances);
        var instances_per_zone = _.groupBy(instances, 'zone');
        var zones_names = instances.zones;
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
        return Q.all(_.map(zones_names, function(zone_name) {
            //console.log('aa');
            var instances = instances_per_zone['https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + zone_name] || [];
            var zone_count = 0;
            if (new_count < count) {
                if (first_zone_extra_count > 0 && zone_name === zones_names[0]) {
                    zone_count = target_zone_count + first_zone_extra_count;
                } else {
                    zone_count = target_zone_count;
                }
                new_count += zone_count;
            }

            return scale_region(zone_name, zone_count, instances, allow_terminate);
        }));
    }).fail(function(err) {
        console.log('error222:', err.stack);
    });
}



/**
 *
 * get_zones
 *
 */
function get_zones(func) {
    //console.log('get_zones1');

    return Q.nfcall(compute.zones.list, {
            project: NooBaaProject,
            auth: authClient
        }).then(func)
        .fail(function(err) {
            console.log('errrrr:', err);
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
        return Q.all(_.map(res[0].items, func));
    }).fail(function(err) {
        console.log('err zone:', err);
    });
}


function scale_region(region_name, count, instances, allow_terminate) {
    //console.log('scale region from ' + instances.length + ' to count ' + count);
    // need to create
    if (count > instances.length) {
        console.log('ScaleRegion:', region_name, 'has', instances.length,
            ' +++ adding', count - instances.length);
        return add_region_instances(region_name, count - instances.length)
            //once the instances are up, we can add disk dependency
            .then(instance_post_creation_handler,
                instance_creation_error_handler,
                instanceCreationProgressHandler);
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
        var death_row = _.first(instances, instances.length - count);
        var ids = _.pluck(death_row, 'name');
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
    console.log(util.inspect(obj, {
        depth: null
    }));
}

function print_instances(instances) {

    if (argv.long) {
        console_inspect('Instances:', instances);
    } else {
        console.log('Total of ',instances.length+' instances');
        _.each(instances, function(current_instance) {
            //console.log('current_instance:'+current_instance);
            var pieces_array = current_instance.zone.split('/');
            var zone_name = pieces_array[pieces_array.length - 1];
            console.log('Instance:',
                current_instance.id,
                current_instance.status || '[no-state]',
                current_instance.networkInterfaces[0].accessConfigs[0].natIP,
                zone_name,
                current_instance.Name || '[no-name]',
                '[private ip ' + current_instance.networkInterfaces[0].networkIP + ']'
            );

        });
    }

}


function instance_post_creation_handler(instance_full_details, callback) {

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
function describe_instances(params) {
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

        return Q.nfcall(compute.instances.list, instancesListParams).then(
            function(instances_list_results) {
                if (instances_list_results[0].hasOwnProperty('items')) {
                    var number_of_instances_in_zone = instances_list_results[0].items.length;
                    created_instance_data = created_instance_data.concat(instances_list_results[0].items);
                }

            }).fail(function(error) {
            console.log('ERROR1:' + JSON.stringify(error) + ':' + error.stack);
        });
    }).then(function(err, data) {
        var instances = _.flatten(created_instance_data);
        // also put the regions list as a "secret" property of the array
        instances.zones = zones;
        return instances;
    }).fail(
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


function getInstanceDataPerInstanceId(instanceId) {
    var instances_per_zone = [];
    var index = 0;
    return compute.zones.list({
        project: NooBaaProject,
        auth: authClient
    }.then(function(zones_list) {
        return Q.all(_.map(zones_list, function(zone_name) {
            var instances = instances_per_zone[zone_name] || [];
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
            return Q.delay(500); // delay, otherwise error from google
        })).then(function() {}).done();

    }));

}

/**
 *
 * add_region_instances
 *
 */
function add_region_instances(region_name, count) {
    var deferred = Q.defer();
    console.log('adding to region ' + region_name + ' ' + count + ' instances');
    var index = 0;
    promiseWhile(function() {
            return index < count;
        }, function() {

            var instanceResource = {

                project: NooBaaProject,
                auth: authClient,
                zone: region_name,
                name: NooBaaProject + region_name + (new Date().getTime()),
                resource: {
                    zone: region_name,
                    name: NooBaaProject + region_name + (new Date().getTime()),
                    machineType: 'https://www.googleapis.com/compute/v1/projects/' + NooBaaProject + '/zones/' + region_name + '/machineTypes/f1-micro',
                    disks: [{
                        initializeParams: {
                            //diskSizeGb: 8000,
                            //sourceImage:'https://www.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/ubuntu-trusty-14.04-amd64-server-20140927'
                            sourceImage: 'https://www.googleapis.com/compute/v1/projects/ubuntu-os-cloud/global/images/ubuntu-1404-trusty-v20141031a'
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
                            value: 'https://s3.amazonaws.com/elasticbeanstalk-us-east-1-628038730422/init_agent.sh'
                            //value: 'https://s3.amazonaws.com/elasticbeanstalk-us-east-1-628038730422/setupgc.sh'
                        }, {
                            key: 'sshKeys',
                            value: 'ubuntu:ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCGk9U7fEXopJnBL1V4rXRzU580GRmUQVyivycKtUPplfjY3iIEU/DodqCCvn8Gb3rckVr7qd+haSE43IhNsB/zH9gGowUydTs3VwCHQT2pkziisr50EjQ0c6eBkcN5nWGZEPUGe4tGSQUR4agstJPyc3YDLJ96mC0ZOZVPtY+9tBUW0JsKqe45oLgCphSTuRP4cR4kiCv7HIzGLZd/ib6NgzlnLJqGBE74zJo0tgVv33Ixqdx8b0TyktNkGhYyjzweujEmkDX4/wVdX/qyWENDWWTb0D3jCAVgCyJBiuDHvtk0ehmcdYNucp0GuNTlO0Ld0NNsOjjAY9Au52lppYM1 ubuntu\n'
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

            return Q.nfcall(compute.instances.insert, instanceResource)
                .then(function(instanceInformation) {
                    var pieces_array = instanceInformation[0].targetLink.split('/');
                    var instanceName = pieces_array[pieces_array.length - 1];
                    console.log('New insatnce name:' + JSON.stringify(instanceName));
                    if (1 === 1) {
                        //waiting until the instance is running. 
                        //Disk dependecy can be added only after the instance is up and running. 
                        var interval = setInterval(function() {
                            var operationsParams = {
                                project: NooBaaProject,
                                zone: instanceResource.zone,
                                operation: instanceInformation[0].name,
                                auth: authClient,
                                instanceName: instanceName
                            };

                            return Q.nfcall(compute.zoneOperations.get, operationsParams)
                                .then(function(operationResource) {
                                    deferred.notify(operationResource);

                                    if (operationResource[0].status === 'DONE') {
                                        console.log('Instance ' + operationsParams.instanceName + ' is up and started installation ' + JSON.stringify(operationResource[0].status));
                                        var instanceDetailedInformationParams = {
                                            instance: operationsParams.instanceName,
                                            zone: operationsParams.zone,
                                            project: NooBaaProject,
                                            auth: authClient,

                                        };
                                        compute.instances.get(instanceDetailedInformationParams, function(err, instanceDetails) {
                                            if (err) {
                                                console.log('Instance get details err:' + JSON.stringify(err));
                                            } else {
                                                deferred.resolve(instanceDetails);
                                                clearInterval(interval);
                                            }
                                        });

                                    }

                                })
                                .fail(function(err) {
                                    console.log('Zone Operation err:' + JSON.stringify(err) + JSON.stringify(operationsParams));
                                    deferred.resolve(null);
                                    clearInterval(interval);
                                });

                        }, 8000);
                    }
                    index++;
                    return Q.delay(1000); // arbitrary async
                });
        }).then(function() {
            console.log('done creating ' + count + ' new instances in zone ' + region_name);
            return deferred.promise;
        })
        .fail(function(error) {
            console.log('ERROR4:' + JSON.stringify(error) + ' ' + error.stack);
        }).done();
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
        return Q.nfcall(compute.instances.delete, terminationParams)
            .then(function(terminationResults) {
                console.log('Termination of instance ' + current_instance + ' done');

            })
            .fail(function(err) {
                console.log('Termination of instance ' + current_instance + ' failed due to error:' + JSON.stringify(err) + err.stack);
                throw err;
            });
    });

}




function init(callback) {
    if (authClient.hasOwnProperty('gapi')) {
        return;
    }
    console.log('waiting for auth');
    setTimeout(function() {
        authClient.authorize(function(err, token) {
            console.log('Authenticated!', token);
            callback(token);
        });
    }, 2000);
}

function main() {
    console.log('before init');
    init(function(data) {
        if (!_.isUndefined(argv.scale)) {
            // add a --term flag to allow removing nodes
            scale_instances(argv.scale, argv.term)
                .then(function(res) {
                    console_inspect('Scale: completed to ' + argv.scale);
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
                })
                .done();
        } else if (!_.isUndefined(argv.instance)) {

            describe_instance(argv.instance)
                .then(function(instance) {
                    console_inspect('Instance ' + argv.instance + ':', instance);
                })
                .done();

        } else {
            //console.log('desc instances');
            describe_instances().then(print_instances).done();
        }
    });

}

if (require.main === module) {
    main();
}