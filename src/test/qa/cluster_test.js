/* Copyright (C) 2016 NooBaa */
'use strict';

const argv = require('minimist')(process.argv);
const AzureFunctions = require('../../deploy/azureFunctions');
const P = require('../../util/promise');
const api = require('../../api');
const promise_utils = require('../../util/promise_utils');
const ops = require('../system_tests/basic_server_ops');
const s3ops = require('../qa/s3ops');
const af = require('../qa/functions/agent_functions');
const _ = require('lodash');

require('../../util/dotenv').load();
const dbg = require('../../util/debug_module')(__filename);
const testName = 'cluster_test';
const suffix = testName.replace(/_test/g, '');
dbg.set_process_name(testName);

//define colors
const YELLOW = "\x1b[33;1m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";

const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
let master_ip;
let rpc;
let client;
const serversincluster = argv.servers || 3;
let failures_in_test = false;
let errors = [];

//defining the required parameters
const {
    location = 'westus2',
    configured_ntp = 'pool.ntp.org',
    configured_timezone = 'US/Pacific',
    prefix = 'Server',
    timeout = 10,
    breakonerror = false,
    resource,
    storage,
    vnet,
    upgrade_pack,
    agents_number = 3,
    clean = false,
    help = false
} = argv;

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --configured_ntp        -   ntp server (default: ${configured_ntp})
    --configured_timezone   -   time zone for the ntp (default: ${configured_timezone})
    --prefix                -   noobaa server prefix name (default: ${prefix}) 
    --timeout               -   time out in min (default: ${timeout})
    --breakonerror          -   will stop the test on error
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --upgrade_pack          -   location of the file for upgrade
    --agents_number         -   number of agents to add (default: ${agents_number})
    --servers               -   number of servers to create cluster from (default: ${serversincluster})
    --clean                 -   will only delete the env and exit.
    --help                  -   show this help
    `);
}

if (help) {
    usage();
    process.exit(1);
}

let osesSet = [
    'ubuntu12', 'ubuntu14', 'ubuntu16',
    'centos6', 'centos7',
    'redhat6', 'redhat7',
    'win2008', 'win2012', 'win2016'
];

let oses = [];

function getRandomAgentsOses() {
    for (let i = 0; i < agents_number; i++) {
        let rand = Math.floor(Math.random() * osesSet.length);
        oses.push(osesSet[rand]);
        osesSet.splice(rand, 1);
    }
    console.log('Random oses for creating agents ', oses);
}

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
let azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);

function isSecretChanged(isMasterDown, oldSecret, masterSecret) {
    if (isMasterDown) {
        if (oldSecret === masterSecret) {
            saveErrorAndResume(`Error - The master didn't move server and it is down`);
            failures_in_test = true;
        } else {
            console.log(`The master has moved - as should from secret: ${oldSecret} to: ${masterSecret}`);
        }
    } else if (oldSecret === masterSecret) {
        console.log(`The master is the same as the old one - as Should`);
    } else {
        saveErrorAndResume(`Error - The master has moved from secret: ${oldSecret} to: ${
            masterSecret} and shouldn't.`);
        failures_in_test = true;
    }
}

function checkClusterHAReport(read_system_res, serversByStatus, servers) {
    const serversUp = serversByStatus.length;
    if (serversUp > (servers.length / 2) + 1) {
        if (read_system_res.cluster.shards[0].high_availabilty) {
            console.log(`Cluster is highly available as should!!`);
        } else {
            console.warn(`Error! Cluster is not highly available although most servers are up!!`);
        }
    } else if (read_system_res.cluster.shards[0].high_availabilty) {
        console.warn(`Error! Cluster is highly available when most servers are down!!`);
    } else {
        console.log(`Cluster is not highly available as should!!`);
    }
}

function checkServersStatus(read_system_res, servers, masterSecret, masterIndex) {
    const serversBySecret = _.groupBy(read_system_res.cluster.shards[0].servers, 'secret');
    console.log(serversBySecret);
    servers.forEach(server => {
        if (serversBySecret[server.secret].length > 1) {
            console.log(`Read system returned more than one server with the same secret!! ${
                serversBySecret[server.secret]
                }`);
            failures_in_test = true;
            throw new Error(`Read System duplicate Secrets!!`);
        }
        let role = '*SLAVE*';
        if (server.secret === masterSecret) {
            masterIndex = servers.indexOf(server);
            console.log('Master index is ', masterIndex);
            role = '*MASTER*';
        }
        if (server.status === serversBySecret[server.secret][0].status) {
            console.log(`Success - ${role} ${server.name} (${server.ip}) secret ${
                server.secret} is of Status ${serversBySecret[server.secret][0].status}`);
        } else {
            console.log(`${role}${server.name} (${server.ip}) secret ${
                server.secret} is of Status ${
                serversBySecret[server.secret][0].status} ${server.status}`);
            console.log(read_system_res.cluster.shards[0]);
        }
        return masterIndex;
    });
}

function checkClusterStatus(servers, oldMasterNumber) {
    let oldSecret = 0;
    let isMasterDown = false;
    let masterIndex = oldMasterNumber;
    let connectedServers = [];
    console.log(servers);
    return azf.getMachineStatus(servers[oldMasterNumber].name)
        .then(res => {
            if (oldMasterNumber > -1) {
                oldSecret = servers[oldMasterNumber].secret;
                if (res !== 'VM running') {
                    isMasterDown = true;
                }
                console.log(`${YELLOW}Previous master is ${servers[oldMasterNumber].name}, status: ${
                    res}${NC}`);
            } else {
                console.log(`${YELLOW}Previous master is undesicive - too much servers were down${NC}`);
            }
        })
        .then(() => {
            console.log('Is master changed: ', isMasterDown);
            if (isMasterDown === true) {
                return azf.listVirtualMachines('Server', 'VM running')
                    .then(res => {
                        connectedServers = res;
                        const connectedMaster = res[0];
                        masterIndex = servers.findIndex(server => server.name === connectedMaster);
                    });
            } else {
                console.log(servers);
                masterIndex = oldMasterNumber;
                servers.forEach(server => {
                    connectedServers.push(server.name);
                });
            }
        })
        .then(() => {
            console.log('Master index is ', masterIndex, 'Master ip is ', servers[masterIndex].ip);
            if (connectedServers.length > 0) {
                return promise_utils.exec('curl http://' + servers[masterIndex].ip + ':8080 2> /dev/null ' +
                    '| grep -o \'[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\\.[0-9]\\{1,3\\}\'', false, true)
                    .catch(() => azf.getIpAddress(servers[masterIndex].name + '_pip')
                        .then(res => {
                            master_ip = res;
                        }))
                    .then(ip => {
                        master_ip = master_ip || ip.trim();
                        console.log('Master ip', master_ip);
                        rpc = api.new_rpc('wss://' + master_ip + ':8443');
                        client = rpc.new_client({});
                        return P.fcall(() => {
                            let auth_params = {
                                email: 'demo@noobaa.com',
                                password: 'DeMo1',
                                system: 'demo'
                            };
                            return client.create_auth_token(auth_params);
                        });
                    })
                    .then(() => {
                        console.log(`Waiting on read system`);
                        return client.system.read_system({});
                    })
                    .then(res => {
                        let masterSecret = res.cluster.master_secret;
                        isSecretChanged(isMasterDown, oldSecret, masterSecret);
                        checkClusterHAReport(res, connectedServers, servers);
                        checkServersStatus(res, servers, masterSecret);
                        if (failures_in_test && breakonerror) {
                            throw new Error('Error in test - breaking the test');
                        }
                        return masterIndex;
                    })
                    .then(() => {
                        master_ip = servers[masterIndex].ip;
                        rpc.disconnect_all();
                        return master_ip;
                    })
                    .catch(err => {
                        if (rpc) rpc.disconnect_all();
                        throw err;
                    });
            } else {
                console.log('Most of the servers are down - Can\'t check cluster status');
                return -1;
            }
        });
}

let servers = [];

function setNTPConfig(serverIndex) {
    rpc = api.new_rpc('wss://' + servers[serverIndex].ip + ':8443');
    client = rpc.new_client({});
    console.log('Secret is ', servers[serverIndex].secret, 'for server ip ', servers[serverIndex].ip);
    return P.fcall(() => {
        let auth_params = {
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        };
        return client.create_auth_token(auth_params);
    })
        .then(() => {
            console.log('Setting ntp config');
            return client.cluster_server.update_time_config({
                target_secret: servers[serverIndex].secret,
                timezone: configured_timezone,
                ntp_server: configured_ntp
            });
        })
        .then(() => {
            console.log('Reading system');
            return client.cluster_server.read_server_config({});
        })
        .then(result => {
            let ntp = result.ntp_server;
            if (ntp === configured_ntp) {
                console.log('The defined ntp is', ntp, '- as should');
            } else {
                saveErrorAndResume('The defined ntp is', ntp, '- failure!!!');
                failures_in_test = true;
            }
            rpc.disconnect_all();
        });
}

//this function is getting servers array creating and upgrading them.
function prepareServers(requestedServers) {
    return P.map(requestedServers, server => azf.createServer(server.name, vnet, storage, 'Static')
        .then(new_secret => {
            console.log(`server.secret: ${new_secret}`);
            server.secret = new_secret;
            return azf.getIpAddress(server.name + '_pip');
        })
        .then(ip => {
            console.log(`${YELLOW}${server.name} and ip is: ${ip}${NC}`);
            server.ip = ip;
            if (!_.isUndefined(upgrade_pack)) {
                return ops.upload_and_upgrade(ip, upgrade_pack);
            }
        })
        .catch(err => {
            saveErrorAndResume('Can\'t create server and upgrade servers', err);
            failures_in_test = true;
            throw err;
        })
    );
}

function delayInSec(sec) {
    console.log(`Waiting ${sec} seconds for cluster to stable...`);
    return P.delay(sec * 1000);
}

function createCluster(requestedServes, masterIndex, clusterIndex) {
    let master = requestedServes[masterIndex].ip;
    let cluster_ip = requestedServes[clusterIndex].ip;
    let cluster_secret = requestedServes[clusterIndex].secret;
    let cluster_name = requestedServes[clusterIndex].name;
    return azf.addServerToCluster(master, cluster_ip, cluster_secret, cluster_name)
        .then(() => delayInSec(90));
}

function verifyS3Server() {
    console.log(`starting the verify s3 server on `, master_ip);
    let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
    return s3ops.create_bucket(master_ip, bucket)
        .then(() => s3ops.get_list_buckets(master_ip))
        .then(res => {
            if (res.includes(bucket)) {
                console.log('Bucket is successfully added');
            } else {
                saveErrorAndResume(`Created bucket ${master_ip} bucket is not returns on list`, res);
            }
        })
        .then(() => s3ops.put_file_with_md5(master_ip, bucket, '100MB_File', 100, 1048576)
            .then(() => s3ops.get_file_check_md5(master_ip, bucket, '100MB_File')))
        .catch(err => {
            saveErrorAndResume(`${master_ip} FAILED verification s3 server`, err);
            failures_in_test = true;
            throw err;
        });
}

function cleanEnv(osToClean) {
    return P.map(servers, server => azf.deleteVirtualMachine(server.name)
        .catch(err => console.log(`Can't delete old server ${err.message}`)))
        .then(() => af.clean_agents(azf, osToClean, suffix))
        .then(() => clean && process.exit(0));
}

//const timeInMin = timeout * 1000 * 60;
console.log(`${YELLOW}Timeout: ${timeout} min${NC}`);
let masterIndex = 0;
console.log('Breaking on error?', breakonerror);

function checkAddClusterRules() {
    return createCluster(servers, masterIndex, 1)
        .catch(err => {
            if (err.message.includes('Could not add members when NTP is not set')) {
                console.log(err.message, ' - as should');
            } else {
                saveErrorAndResume('Error is not returned when add cluster without set ntp in master');
            }
        })
        .then(() => setNTPConfig(0))
        .then(() => createCluster(servers, masterIndex, 1)
            .catch(err => {
                if (err.message.includes('Could not add members when NTP is not set')) {
                    console.log(err.message, ' - as should');
                } else {
                    console.warn('Error is not returned when add cluster without set ntp in in cluster server');
                }
            }));
}

function runFirstFlow() {
    console.log(`${RED}<======= Starting first flow =======>${NC}`);
    return azf.stopVirtualMachine(servers[1].name)
        .then(() => delayInSec(90))
        .then(verifyS3Server)
        .then(() => azf.startVirtualMachine(servers[1].name))
        .then(() => delayInSec(180))
        .then(verifyS3Server)
        .then(() => checkClusterStatus(servers, masterIndex));
}

function runSecondFlow() {
    console.log(`${RED}<==== Starting second flow ====>${NC}`);
    return azf.stopVirtualMachine(servers[1].name)
        .then(() => delayInSec(90))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server)
        .then(() => azf.stopVirtualMachine(servers[2].name))
        .then(() => delayInSec(90))
        .then(() => {
            let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
            return s3ops.create_bucket(master_ip, bucket)
                .catch(err => console.log(`Couldn't create bucket with 2 disconnected clusters - as should ${err.message}`));
        })
        .then(() => azf.startVirtualMachine(servers[1].name))
        .then(() => delayInSec(180))
        .then(verifyS3Server)
        .then(() => azf.startVirtualMachine(servers[2].name))
        .then(() => delayInSec(180))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server);
}

function runThirdFlow() {
    console.log(`${RED}<==== Starting third flow ====>${NC}`);
    return azf.stopVirtualMachine(servers[1].name)
        .then(() => azf.stopVirtualMachine(servers[2].name))
        .then(() => delayInSec(180))
        .then(() => {
            let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
            return s3ops.create_bucket(master_ip, bucket)
                .catch(err => console.log(`Couldn't create bucket with 2 disconnected clusters - as should ${err.message}`));
        })
        .then(() => azf.stopVirtualMachine(servers[0].name))
        .then(() => azf.startVirtualMachine(servers[1].name))
        .then(() => azf.startVirtualMachine(servers[2].name))
        .then(() => delayInSec(180))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server)
        .then(() => azf.startVirtualMachine(servers[0].name))
        .then(() => delayInSec(180))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server);
}

function runForthFlow() {
    console.log(`${RED}<==== Starting forth flow ====>${NC}`);
    return azf.stopVirtualMachine(servers[masterIndex].name)
        .then(() => delayInSec(180))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server)
        .then(() => azf.startVirtualMachine(servers[masterIndex].name))
        .then(() => delayInSec(180))
        .then(() => checkClusterStatus(servers, masterIndex))
        .then(verifyS3Server);
}

return azf.authenticate()
    .then(() => {
        for (let i = 0; i < serversincluster; ++i) {
            servers.push({
                name: prefix + i,
                secret: '',
                ip: '',
                status: 'CONNECTED'
            });
        }
    })
    .then(() => cleanEnv(osesSet))
    .then(() => prepareServers(servers))
    .then(checkAddClusterRules)
    .then(() => setNTPConfig(1))
    .then(() => createCluster(servers, masterIndex, 1))
    .then(() => setNTPConfig(2))
    .then(() => createCluster(servers, masterIndex, 2))
    .then(() => delayInSec(90))
    .then(() => checkClusterStatus(servers, masterIndex)) //TODO: remove... ??
    .then(getRandomAgentsOses)
    .then(() => af.createAgentsWithList({
        azf,
        server_ip: master_ip,
        storage,
        vnet,
        exclude_drives: undefined,
        suffix,
        oses
    }))
    .then(verifyS3Server)
    .then(() => checkClusterStatus(servers, masterIndex))
    .then(runFirstFlow)
    .then(runSecondFlow)
    .then(runThirdFlow)
    .then(runForthFlow)
    .then(() => cleanEnv(oses))

    /*
      .then(() => {
          const start = Date.now();
          let cycle = 0;
          return promise_utils.pwhile(() => (timeout === 0 || (Date.now() - start) < timeInMin), () => {
              let rand = Math.floor(Math.random() * serversincluster);
              console.log(`${RED}<==== Starting a new cycle ${cycle}... ====>${NC}`);
              let prom;
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
                  .then(newMaster => {
                      masterIndex = newMaster;
                  });
          });
      })
      */
    .catch(err => {
        console.error(`something went wrong ${err} ${errors}`);
        failures_in_test = true;
    })
    .then(() => {
        if (failures_in_test) {
            console.error(`Errors during cluster test ${errors}`);
            process.exit(1);
        }
        console.log(`Cluster test were successful!`);
        process.exit(0);
        // return clean ? cleanEnv() : console.log('Clean env is ', clean);
    });
