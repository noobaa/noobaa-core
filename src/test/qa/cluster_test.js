/* Copyright (C) 2016 NooBaa */
'use strict';

var argv = require('minimist')(process.argv);
var AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
var api = require('../../api');
var promise_utils = require('../../util/promise_utils');
var ops = require('../system_tests/basic_server_ops');
const s3ops = require('../qa/s3ops');
var _ = require('lodash');

require('../../util/dotenv').load();

//define colors
const YELLOW = "\x1b[33;1m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

var clientId = process.env.CLIENT_ID;
var domain = process.env.DOMAIN;
var secret = process.env.APPLICATION_SECRET;
var subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
var master_ip;
var rpc;
var client;
const serversincluster = argv.servers || 3;
let failures_in_test = false;
let errors = [];
let agentConf;

//defining the required parameters
const {
    location = 'westus2',
    prefix = 'Server',
    timeout = 10,
    breakonerror = false,
    resource,
    storage,
    vnet,
    upgrade_pack,
    clean = false
} = argv;

const oses = [
    'ubuntu12', 'ubuntu14', 'ubuntu16'];

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
var azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function isSecretChanged(isMasterDown, oldSecret, masterSecret) {
    if (isMasterDown) {
        if (oldSecret === masterSecret) {
            console.log(`Error - The master didn't move server and it is down`);
            failures_in_test = true;
        } else {
            console.log(`The master has moved - as should from secret: ${oldSecret} to: ${masterSecret}`);
        }
    } else if (oldSecret === masterSecret) {
        console.log(`The master is the same as the old one - as Should`);
    } else {
        saveErrorAndResume(`Error - The master has moved from secret: ${oldSecret} to: ${
            masterSecret} and shoulden't.`);
        failures_in_test = true;
    }
}

function checkClusterHAReport(read_system_res, serversByStatus, servers) {
    const serversUp = serversByStatus.CONNECTED.length;
    if (serversUp > (servers.length / 2) + 1) {
        if (read_system_res.cluster.shards[0].high_availabilty) {
            console.log(`Cluster is highly available as should!!`);
        } else {
            saveErrorAndResume(`Error! Cluster is not highly available although most servers are up!!`);
            failures_in_test = true;
        }
    } else if (read_system_res.cluster.shards[0].high_availabilty) {
        console.log(`Error! Cluster is highly available when most servers are down!!`);
        failures_in_test = true;
    } else {
        console.log(`Cluster is not highly available as should!!`);
    }
}


function checkServersStatus(read_system_res, servers, masterSecret, masterIndex) {
    const serversBySecret = _.groupBy(read_system_res.cluster.shards[0].servers, 'secret');
    servers.forEach(server => {
        if (serversBySecret[server.secret].length > 1) {
            console.log(`Read system returned more than one server with the same secret!! ${
                serversBySecret[server.secret]
                }`);
            failures_in_test = true;
            throw new Error(`Read System duplicate Secrets!!`);
        }
        var role = '*SLAVE*';
        if (server.secret === masterSecret) {
            masterIndex = servers.indexOf(server);
            role = '*MASTER*';
        }
        if (server.status === serversBySecret[server.secret][0].status) {
            console.log(`Success - ${role} ${server.name} (${server.ip}) secret ${
                server.secret} is of Status ${serversBySecret[server.secret][0].status} - As should`);
        } else {
            console.log(`Error - ${role}${server.name} (${server.ip}) secret ${
                server.secret} is of Status ${
                serversBySecret[server.secret][0].status} - should be ${server.status}`);
            console.log(read_system_res.cluster.shards[0]);
            failures_in_test = true;
        }
    });
}

function checkClusterStatus(servers, oldMasterNumber) {
    var oldSecret = 0;
    var isMasterDown = true;
    if (oldMasterNumber > -1) {
        oldSecret = servers[oldMasterNumber].secret;
        isMasterDown = servers[oldMasterNumber].status !== 'CONNECTED';
        console.log(`${YELLOW}Previous master is ${servers[oldMasterNumber].name}, status: ${
            servers[oldMasterNumber].status}${NC}`);
    } else {
        console.log(`${YELLOW}Previous master is undesicive - too much servers were down${NC}`);
    }
    var serversByStatus = _.groupBy(servers, 'status');
    var masterIndex = oldMasterNumber;
    if (serversByStatus.CONNECTED && serversByStatus.CONNECTED.length > (servers.length / 2)) {
        return promise_utils.exec('curl http://' + serversByStatus.CONNECTED[0].ip + ':8080 2> /dev/null ' +
            '| grep -o \'[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\'', false, true)
            .catch(() => {
                master_ip = serversByStatus.CONNECTED[0].ip;
            })
            .then(ip => {
                master_ip = master_ip || ip.trim();
                console.log('Master ip', master_ip);
                rpc = api.new_rpc('wss://' + master_ip + ':8443');
                client = rpc.new_client({});
                rpc.disable_validation();
                return P.fcall(() => {
                    var auth_params = {
                        email: 'demo@noobaa.com',
                        password: 'DeMo1',
                        system: 'demo'
                    };
                    return client.create_auth_token(auth_params);
                });
            })
            .then(() => {
                console.log(`Waiting on read system`);
                return P.resolve(client.system.read_system({}));
            })
            .then(res => {
                var masterSecret = res.cluster.master_secret;
                isSecretChanged(isMasterDown, oldSecret, masterSecret);
                checkClusterHAReport(res, serversByStatus, servers);
                checkServersStatus(res, servers, masterSecret, masterIndex);
                if (failures_in_test && breakonerror) {
                    throw new Error('Error in test - breaking the test');
                }
                return masterIndex;
            });
          //  .finally(() => rpc.disconnect_all());
    } else {
        console.log('Most of the servers are down - Can\'t check cluster status');
        return -1;
    }
}

let servers = [];
let master;
let slaves;

//this function is getting servers array creating and upgrading them.
function preparServers(requestedServers) {
    return P.map(requestedServers, server => azf.createServer(server.name, vnet, storage)
        .then(new_secret => {
            server.secret = new_secret;
            return azf.getIpAddress(server.name + '_pip');
        })
        .then(ip => {
            console.log(`${YELLOW}${server.name} ip is: ${ip}${NC}`);
            server.ip = ip;
            if (!_.isUndefined(upgrade_pack)) {
                return ops.upload_and_upgrade(ip, upgrade_pack);
            }
        })
    ).catch(err => {
            saveErrorAndResume('Can\'t create server and upgrade servers', err);
            failures_in_test = true;
            throw err;
        });
}

function delayInSec(sec) {
    console.log(`Waiting ${sec} seconds for cluster to stable...`);
    return P.delay(sec * 1000);
}

function createCluster(requestedServers) {
    slaves = Array.from(requestedServers);
    master = slaves.shift();
    return P.each(slaves, slave => azf.addServerToCluster(master.ip, slave.ip, slave.secret, slave.name))
        .then(() => delayInSec(90));
}

function createAgents() {
    return getAgentConf()
        .then(res => P.map(oses, osname => azf.createAgent(
        osname, storage, vnet,
        azf.getImagesfromOSname(osname), master_ip, res)))
        .catch(err => {
            saveErrorAndResume(`${master_ip} FAILED creating agents`, err);
            failures_in_test = true;
            throw err;
        });
}

function getAgentConf() {
    return client.system.get_node_installation_string({
        pool: "first.pool",
        exclude_drives: []
    })
        .then(installationString => {
            console.log('Installation string is: ' + installationString.LINUX);
            agentConf = installationString.LINUX;
            const index = agentConf.indexOf('config');
            agentConf = agentConf.substring(index + 7);
            console.log(agentConf);
        });
}

function deleteAgents() {
    return P.map(oses, osname => azf.deleteVirtualMachine(osname))
        .catch(err => {
            console.warn(`Deleting agents is FAILED `, err);
        });
}

function verifyS3Server() {
    console.log(`starting the verify s3 server`);
    var bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
    return s3ops.create_bucket(master_ip, bucket)
        .then(() => s3ops.get_list_buckets(master_ip))
        .then(res => {
            if (res.includes(bucket)) {
                console.log('Bucket is successfully added');
            } else {
                saveErrorAndResume('Created bucket ' + bucket + 'is not returns on list ' + res);
            }
        })
        //.then(() => s3ops.put_file_with_md5(master_ip, bucket, '100MB_File', 100, 1048576))
        //.then(() => s3ops.get_file_check_md5(master_ip, bucket, '100MB_File'))
        .catch(err => {
            saveErrorAndResume(`${master_ip} FAILED verification s3 server`, err);
            failures_in_test = true;
            throw err;
        });
}
function cleanEnv() {
    return P.map(servers, server => azf.deleteVirtualMachine(server.name)
        .catch(err => console.log('Can\'t delete old server', err.message)))
        .then(() => clean && process.exit(0))
        .then(() => deleteAgents());
}

//const timeInMin = timeout * 1000 * 60;
console.log(`${YELLOW}Timeout in min is: ${timeout}${NC}`);
// var masterIndex = serversincluster + 1;
let masterIndex = 0;
console.log('Breaking on error?', breakonerror);

return azf.authenticate()
    .then(() => {
        for (var i = 0; i < serversincluster; ++i) {
            servers.push({
                name: prefix + i,
                secret: '',
                ip: '',
                status: 'CONNECTED'
            });
        }
    })
    .then(() => cleanEnv())
    .then(() => preparServers(servers))
    .then(() => createCluster(servers))
    .then(() => checkClusterStatus(servers, masterIndex)) //TODO: remove... ??
    //.then(() => checkClusterStatus(servers, 0)) //TODO: remove...
    .then(() => createAgents())
    .then(() => verifyS3Server())
    .then(() => {
        console.log(`${RED}<==== Starting first flow ====>${NC}`);
        return azf.stopVirtualMachine(servers[1].name);
    })
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => azf.startVirtualMachine(servers[1].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(() => {
        console.log(`${RED}<==== Starting second flow ====>${NC}`);
        return azf.stopVirtualMachine(servers[1].name);
    })
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => azf.stopVirtualMachine(servers[2].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => azf.startVirtualMachine(servers[1].name))
    .then(() => verifyS3Server())
    .then(() => azf.startVirtualMachine(servers[2].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(() => {
        console.log(`${RED}<==== Starting third flow ====>${NC}`);
        return azf.stopVirtualMachine(servers[1].name);
    })
    .then(() => azf.stopVirtualMachine(servers[2].name))
    .then(() => delayInSec(90))
    .then(() => s3ops.put_file_with_md5(master_ip, 'files', '100MB_File', 100, 1048576)
        .catch(err => console.log('Couldn\'t upload file wih 2 disconnected clusters - as should ', err.message)))
    .then(() => azf.stopVirtualMachine(servers[0].name))
    .then(() => azf.startVirtualMachine(servers[1].name))
    .then(() => azf.startVirtualMachine(servers[2].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => azf.startVirtualMachine(servers[0].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(() => {
        console.log(`${RED}<==== Starting forth flow ====>${NC}`);
        return azf.stopVirtualMachine(servers[0].name);
    })
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => azf.startVirtualMachine(servers[0].name))
    .then(() => delayInSec(90))
    .then(() => verifyS3Server())
    .then(() => checkClusterStatus(servers, masterIndex))

  /*
    .then(() => {
        const start = Date.now();
        let cycle = 0;
        return promise_utils.pwhile(() => (timeout === 0 || (Date.now() - start) < timeInMin), () => {
            var rand = Math.floor(Math.random() * serversincluster);
            console.log(`${RED}<==== Starting a new cycle ${cycle}... ====>${NC}`);
            var prom;
            if (servers[rand].status === 'CONNECTED') {
                servers[rand].status = 'DISCONNECTED';
                prom = azf.stopVirtualMachine(servers[rand].name); // turn the server off
            } else {
                servers[rand].status = 'CONNECTED';
                prom = azf.startVirtualMachine(servers[rand].name); // turn the server back on
            }
            cycle += 1;
            return prom
                .then(() => delayInSec(180))
                .then(() => checkClusterStatus(servers, masterIndex))
                .then(() => verifyS3Server())
                .then(newMaster => {
                    masterIndex = newMaster;
                });
        });
    })
    */
    .catch(err => {
        console.error('something went wrong :(' + err);
        failures_in_test = true;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(':( :( Errors during cluster test ): ):' + errors);
            process.exit(1);
        }
        console.log(':) :) :) cluster test were successful! (: (: (:');
        return cleanEnv();
    });
