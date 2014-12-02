"use strict";

var _ = require('lodash');
var Q = require('q');
var fs = require('fs');
var async = require('async');
var dotenv = require('dotenv');
var argv = require('minimist')(process.argv);
var AWS = require('aws-sdk');


/* load aws config from env */
console.log('Loading configuration...');

if (!process.env.AWS_ACCESS_KEY_ID) {
    console.log('loading .env file ( no foreman ;)');
    dotenv.load();
}

// AWS.config.loadFromPath('./env.js');
AWS.config.update({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: 'us-east-1',
    // region: process.env.AWS_REGION,
});

var PEM_FILE_PATH = __dirname + '/NooBaa.pub';


/**
 *
 * NB_EC2
 *
 * noobaa's ec2 wrapper
 *
 */
var nb_ec2 = {
    init: init,
    createSecurityGroup: createSecurityGroup,
    importNooBaaKeys: importNooBaaKeys,
    getSetupFullDetails: getSetupFullDetails,
    getInstanceDataPerInstanceId: getInstanceDataPerInstanceId,
    getPrivateIPAddressPerInstanceId: getPrivateIPAddressPerInstanceId,
    getStatePerInstanceId: getStatePerInstanceId,
    createInstancesInRegion: createInstancesInRegion,
    createNewInstancesInRegion: createNewInstancesInRegion,
    scaleInstances: scaleInstances,
    terminateInstance: terminateInstance,
    terminateInstancesInReservation: terminateInstancesInReservation,
    terminateInstancesInRegion: terminateInstancesInRegion,
    terminateInstances: terminateInstances,
};

module.exports = nb_ec2;

// the run script to send to started instances
var run_script = fs.readFileSync(__dirname + '/run_agent.sh');


/**
 *
 *
 *
 */
function init(callback) {
    console.log('Loaded configuration...');
    callback();
}


/**
 *
 *
 *
 */
function createSecurityGroup(regionName, callback) {
    var ec2 = new AWS.EC2({
        region: regionName
    });
    var securityGroupParams = {
        GroupNames: [
            'ssh_and_http_v2',
        ]
    };
    ec2.describeSecurityGroups(securityGroupParams, function(err, securityGroupData) {
        if (err) {

            console.log('Security Group is missing in ' + regionName);
            var securityGroupCreationParams = {
                Description: 'SSH and HTTP v2',
                GroupName: 'ssh_and_http_v2'
            };
            ec2 = new AWS.EC2({
                region: regionName
            });
            ec2.createSecurityGroup(securityGroupCreationParams, function(err, data) {
                if (err) {
                    console.log('Dup in ' + regionName);
                } else {
                    console.log('Created Security Group:' + JSON.stringify(data));
                    var openPortsParam = {
                        GroupId: data.GroupId,

                        GroupName: securityGroupCreationParams.GroupName,
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

                    };
                    ec2.authorizeSecurityGroupIngress(openPortsParam, function(err, data) {
                        if (err) console.log('Rules exist');
                        else console.log('Opened port 22 and 80');
                    });
                    callback();
                }
            });

        } else {
            callback();
        }
    });
}


/**
 *
 *
 *
 */
function importNooBaaKeys(regionName, callback) {
    fs.readFile(PEM_FILE_PATH, function(err, pemData) {
        if (err) throw err;
        else {
            var params = {
                KeyName: 'NooBaa',

                PublicKeyMaterial: pemData
            };
            var ec2 = new AWS.EC2({
                region: regionName
            });
            ec2.importKeyPair(params, function(err, importKey) {
                if (err) {
                    callback();
                } else {
                    console.log('Import (' + regionName + ')' + importKey);
                    callback();
                }
            });
        }
    });
}


/**
 *
 * getSetupFullDetails
 *
 * @return setupInformation <Promise(Array)>
 *
 */
function getSetupFullDetails(callback) {
    var setupInformation = [];
    var ec2 = new AWS.EC2();
    return Q.nfcall(ec2.describeRegions.bind(ec2), {})
        .then(function(data) {
            return Q.all(_.map(data.Regions, function(currentRegion) {
                var ec2_region = new AWS.EC2({
                    region: currentRegion.RegionName
                });
                return Q.nfcall(ec2_region.describeInstances.bind(ec2_region), {})
                    .then(function(data) {
                        if (data.Reservations.length > 0) {
                            setupInformation.push(data.Reservations[0].Instances);
                        }
                    });
            }));
        })
        .then(function() {
            return setupInformation;
        }, function(err) {
            console.error('ERROR getSetupFullDetails:', err);
            throw err;
        });
}


/**
 *
 *
 *
 */
function getInstanceDataPerInstanceId(instanceId, callback) {
    var params = {};
    var ec2 = new AWS.EC2();
    ec2.describeRegions(params, function(err, data) {
        if (err) {
            callback(err, err.stack);
        } else {

            var instanceDataPromises = (data.Regions).map(function(currentRegion) {
                var describeInstancesParams = {
                    InstanceIds: [instanceId]
                };

                ec2 = new AWS.EC2({
                    region: currentRegion.RegionName
                });

                ec2.describeInstances(describeInstancesParams, function(err, data) {
                    if (err) {} else {
                        if (data.Reservations.length > 0) {
                            callback(err, data.Reservations[0].Instances[0]);
                        }


                    }
                });

            });

        }
    });
}


/**
 *
 *
 *
 */
function getPrivateIPAddressPerInstanceId(instanceId, callback) {
    getInstanceDataPerInstanceId(instanceId, function(err, data) {
        if (err) {
            console.log('Error while getting instance private address', err);
        } else {
            callback(err, data.PrivateIpAddress);
        }

    });
}


/**
 *
 *
 *
 */
function getStatePerInstanceId(instanceId, callback) {
    getInstanceDataPerInstanceId(instanceId, function(err, data) {
        if (err) {
            console.log('Error while getting instance private address', err);
            return callback(err);
        }
        return callback(err, data.State.Name);
    });
}


/**
 *
 *
 *
 */
function createInstancesInRegion(instancesInRegion, callback) {
    var numberOfInstances = instancesInRegion.numberOfInstances;
    var regionName = instancesInRegion.regionName;
    var ec2 = new AWS.EC2({
        region: regionName
    });
    var describeInstancesParams = {
        Filters: [{
            Name: 'instance-state-name',
            Values: ['running', 'pending']
        }]
    };
    ec2.describeInstances(describeInstancesParams, function(err, data) {
        var createdInstanceData = [];
        if (err) console.log(err, err.stack);
        else {
            var instancesInRegion = [];
            _(data.Reservations).forEach(function(reservation) {
                instancesInRegion = instancesInRegion.concat(reservation.Instances);
            });
            console.log('Region ' + regionName + ' has ' + instancesInRegion.length + ' instances');

            if (numberOfInstances > instancesInRegion.length) {
                numberOfInstances = numberOfInstances - instancesInRegion.length;
                var newInstancesParams = {
                    numberOfInstances: numberOfInstances,
                    regionName: regionName
                };
                createNewInstancesInRegion(newInstancesParams, function(err, newInstancesData) {
                    if (err) console.log(err, err.stack);
                    else {
                        callback(err, newInstancesData);
                    }
                });
            } else {
                //need to terminate
                if (numberOfInstances < instancesInRegion.length) {
                    var numberOfinstancesToTerminate = instancesInRegion.length - numberOfInstances;
                    var terminateParams = {
                        InstanceIds: []
                    };
                    _(instancesInRegion).forEach(function(instanceItem) {
                        if (numberOfinstancesToTerminate > terminateParams.InstanceIds.length) {
                            terminateParams.InstanceIds.push(instanceItem.InstanceId);
                        }

                    });
                    ec2 = new AWS.EC2({
                        region: regionName
                    });
                    ec2.terminateInstances(terminateParams, function(err, data) {
                        if (err) console.log(err, err.stack);
                        else {
                            callback(err, null);
                        }
                    });
                } else {
                    callback(err, null);
                }
            }

        }
    });
}


/**
 *
 *
 *
 */
function createNewInstancesInRegion(instancesInRegion, callback) {
    var numberOfInstances = instancesInRegion.numberOfInstances;
    var regionName = instancesInRegion.regionName;
    createSecurityGroup(regionName, function() {

        var amiParams = {

            Filters: [{
                Name: 'name',
                Values: [
                    'ubuntu/images/hvm-ssd/ubuntu-trusty-14.04-amd64-server-20140927',
                ]
            }, ]
        };
        var ec2 = new AWS.EC2({
            region: regionName
        });
        ec2.describeImages(amiParams, function(err, amiData) {
            if (err) console.log(err, err.stack);
            else {
                importNooBaaKeys(regionName, function() {
                    var params = {
                        ImageId: amiData.Images[0].ImageId,
                        MaxCount: numberOfInstances,
                        MinCount: numberOfInstances,
                        InstanceType: 't2.micro',
                        KeyName: 'NooBaa',
                        SecurityGroups: ['ssh_and_http_v2'],
                        UserData: new Buffer(run_script).toString('base64'),
                    };
                    ec2 = new AWS.EC2({
                        region: regionName
                    });
                    ec2.runInstances(params, function(err, instanceData) {
                        if (err) console.log(err, err.stack);
                        else {
                            callback(err, instanceData);
                        }
                    });

                });
            }
        });

    });
}


/**
 *
 *
 *
 */
function scaleInstances(numberOfInstances, callback) {
    var params = {};
    var ec2 = new AWS.EC2();
    ec2.describeRegions(params, function(err, data) {
        if (err) console.log(err, err.stack);
        else {
            //console.log(JSON.stringify(data));
            var targetNumberOfInstancesPerRegion = 0;
            var numberOfAdditionalInstancesInTheFirstRegion = 0;

            //if number of instances is smaller than the number of regions,
            //We will add one instance per region until we have enough instances.
            if (numberOfInstances < data.Regions.length) {
                if (numberOfInstances === 0) {
                    targetNumberOfInstancesPerRegion = 0;
                } else {
                    targetNumberOfInstancesPerRegion = 1;
                }

            } else {
                //Div instances equally per region.
                //The first region will get the redundant instances
                targetNumberOfInstancesPerRegion = Math.floor(numberOfInstances / data.Regions.length);
                numberOfAdditionalInstancesInTheFirstRegion = (numberOfInstances % data.Regions.length);
                if (targetNumberOfInstancesPerRegion > 20) {
                    targetNumberOfInstancesPerRegion = 20;
                    numberOfAdditionalInstancesInTheFirstRegion = 0;
                    console.log('Cannot scale to over 20 instances per region. will scale to 20');
                }
            }

            console.log('Scale to ' + targetNumberOfInstancesPerRegion + ' instances per region.(' + data.Regions.length + ' regions)');
            console.log('Scale to ' + (targetNumberOfInstancesPerRegion + numberOfAdditionalInstancesInTheFirstRegion) + ' instances in the first region.');

            var numberOfNewInstances = 0;
            var createdInstanceData = [];

            var promises = (data.Regions).map(function(currentRegion) {
                var instanceCreationParams = {
                    numberOfInstances: 0,
                    regionName: currentRegion.RegionName
                };
                if (numberOfNewInstances < numberOfInstances) {

                    if (numberOfAdditionalInstancesInTheFirstRegion > 0 &&
                        currentRegion.RegionName === data.Regions[0].RegionName) {

                        instanceCreationParams = {
                            numberOfInstances: targetNumberOfInstancesPerRegion + numberOfAdditionalInstancesInTheFirstRegion,
                            regionName: currentRegion.RegionName
                        };
                    } else {
                        instanceCreationParams = {
                            numberOfInstances: targetNumberOfInstancesPerRegion,
                            regionName: currentRegion.RegionName
                        };
                    }
                    numberOfNewInstances = numberOfNewInstances + instanceCreationParams.numberOfInstances;

                }
                return Q.nfcall(createInstancesInRegion, instanceCreationParams).then(
                    function(mydata) {
                        if (mydata !== null) {
                            createdInstanceData = createdInstanceData.concat(mydata.Instances);
                        }

                    });
            });

            Q.all(promises).then(function(err, data) {
                callback(null, createdInstanceData);
            }).fail(
                function(error) {
                    console.log('ERROR3:' + JSON.stringify(error));
                }
            );

        }
    });
}


/**
 *
 *
 *
 */
function terminateInstance(instanceId, callback) {
    var terminateParams = {
        InstanceIds: [instanceId],
    };
    var ec2 = new AWS.EC2();
    ec2.terminateInstances(terminateParams, function(err, data) {
        if (err) console.log(err, err.stack);
        else callback(err, data);
    });
}


/**
 *
 *
 *
 */
function terminateInstancesInReservation(reservationParams, callback) {
    var instancedInReservationData = [];
    var instancesPromises = (reservationParams.reservation.Instances).map(function(currentInstance) {
        var ec2 = new AWS.EC2({
            region: reservationParams.regionName
        });
        return Q.nfcall(terminateInstance, currentInstance.InstanceId).then(
            function(err, terminatedInstanceData) {
                instancedInReservationData = instancedInReservationData.concat(terminatedInstanceData);
            });
    });
    Q.all(instancesPromises).then(function() {
        callback(null, instancedInReservationData);
    }).fail(
        function(error) {
            console.log('ERROR:' + JSON.stringify(error));
        }
    );
}


/**
 *
 *
 *
 */
function terminateInstancesInRegion(regionName, callback) {

    var ec2 = new AWS.EC2({
        region: regionName
    });
    var describeInstancesParams = {
        Filters: [{
            Name: 'instance-state-name',
            Values: ['running', 'pending']
        }]
    };
    ec2.describeInstances(describeInstancesParams, function(err, data) {
        var createdInstanceData = [];
        if (err) console.log(err, err.stack);
        else {

            if (data.Reservations.length > 0) {
                var reservationPromises = (data.Reservations).map(function(currentReservation) {
                    var reservationParam = {
                        reservation: currentReservation,
                        regionName: regionName
                    };
                    return Q.nfcall(terminateInstancesInReservation, reservationParam).then(
                        function(err, terminatedInstancesInReservationData) {
                            createdInstanceData = createdInstanceData.concat(terminatedInstancesInReservationData);
                        });
                });

                Q.all(reservationPromises).then(function() {
                    callback(createdInstanceData);
                }).fail(
                    function(error) {
                        console.log('ERROR:' + error);
                    }
                );
            } else {
                console.log('No reservations for region:' + regionName);
                callback(err, null);
            }
        }

    });
}


/**
 *
 *
 *
 */
function terminateInstances() {
    var params = {};
    var ec2 = new AWS.EC2();
    ec2.describeRegions(params, function(err, data) {
        if (err) console.log(err, err.stack);
        else {

            //loop all instances and delete
            async.forEachSeries(data.Regions, function(currentRegion, regionCallback) {
                console.log('Termnating all instances in region:' + currentRegion.RegionName);
                terminateInstancesInRegion(currentRegion.RegionName, function(err, data) {
                    regionCallback();
                });

            }, function() {
                //After we created all instances
                console.log('Terminated all instances in all regions');
            });
        }
    });
}



/**
 *
 *
 *
 */
function main() {
    if (argv.scale) {
        nb_ec2.scaleInstances(argv.scale, function(err, data) {
            console.log("Scale:", argv.scale);
            console.log(err || data);
            getSetupFullDetails().done(function(data) {
                console.log('Details:');
                console.log(data);
            });
        });
    } else if (argv.instance) {
        nb_ec2.getStatePerInstanceId(argv.instance, function(err, data) {
            console.log("Instance:", argv.instance);
            console.log(err || data);
        });
    } else {
        getSetupFullDetails().done(function(data) {
            console.log('Details:');
            console.log(data);
        });
    }
}

if (require.main === module) {
    main();
}
