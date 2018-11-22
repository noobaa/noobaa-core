/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const af = require('../utils/agent_functions');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const argv = require('minimist')(process.argv);
const Report = require('../framework/report');
const srv_ops = require('../utils/basic_server_ops');
const { S3OPS } = require('../utils/s3ops');
const promise_utils = require('../../util/promise_utils');
const AzureFunctions = require('../../deploy/azureFunctions');


const testName = 'cluster_test';
let suffix = testName.replace(/_test/g, '');
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
let s3ops;
let rpc;
let client;
const serversInCluster = argv.servers || 3;
let failures_in_test = false;
let errors = [];
let cluster_servers = [];

//defining the required parameters
const {
    location = 'westus2',
        configured_ntp = 'time.windows.com',
        configured_timezone = 'Asia/Jerusalem',
        timeout = 10,
        breakonerror = false,
        resource,
        storage,
        vnet,
        upgrade_pack,
        id,
        agents_number = 3,
        clean = false,
} = argv;

let {
    prefix = 'Server'
} = argv;

if (id !== undefined) {
    prefix = prefix + '-' + id;
    suffix = suffix + '-' + id;
}

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
    --id                    -   an id that is attached to the server names
    --upgrade_pack          -   location of the file for upgrade
    --agents_number         -   number of agents to add (default: ${agents_number})
    --servers               -   number of servers to create cluster from (default: ${serversInCluster})
    --clean                 -   will only delete the env and exit.
    --help                  -   show this help
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

const osesSet = af.supported_oses();
const report = new Report();
const cases = [
    'Add member no NTP master',
    'Add member no NTP 2nd',
    'Stop/start same member',
    'succeeded config 2/3 down',
    'Stop/start 2/3 of cluster',
    'stop all start all',
    'stop all start two',
    'succeeded config 2/3 down',
    'stop master',
    'stop/start master',
    'create bucket pre test',
    'ul and verify obj pre test',
    'create bucket one srv down',
    'ul and verify obj one srv down',
    'create bucket all up after one down',
    'ul and verify obj all up after one down',
    'create bucket one srv down after 2 down',
    'ul and verify obj one srv down after 2 down',
    'create bucket all up after 2 down',
    'ul and verify obj all up after 2 down',
    'create bucket one down after all down',
    'ul and verify obj one down after all down',
    'create bucket all up after all down',
    'ul and verify obj all up after all down',
    'create bucket stop master',
    'ul and verify obj stop master',
    'create bucket stop/start master',
    'ul and verify obj stop/start master',
];
report.init_reporter({ suite: testName, conf: { agents_number: agents_number }, mongo_report: true, cases: cases });


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

function checkClusterHAReport(serversByStatus, servers) {
    console.log(`Checking if the cluster is Highly Available`);
    const serversUp = serversByStatus.length;
    return client.system.read_system({})
        .then(res => {
            if (serversUp > (servers.length / 2) + 1) {
                if (res.cluster.shards[0].high_availabilty) {
                    console.log(`Cluster is highly available as should!!`);
                } else {
                    let done = false;
                    let timeOut = 0;
                    let timeInSec = 10;
                    return promise_utils.pwhile(
                        () => !done,
                        () => client.system.read_system({})
                        .then(read_system => {
                            if (read_system.cluster.shards[0].high_availabilty) {
                                done = true;
                                //setting time out of 300 sec
                            } else if (timeOut > 300) {
                                done = true;
                                return P.resolve()
                                    .then(() => {
                                        console.log(`Number of live servers is: ${serversUp}, out of ${servers.length}`);
                                        console.log('read_system high_availabilty status is: ', res.cluster.shards[0].high_availabilty);
                                        saveErrorAndResume(`Error! Cluster is not highly available although most servers are up!!`);
                                        failures_in_test = true;
                                    });
                            } else {
                                timeOut += timeInSec;
                                return P.delay(timeInSec * 1000);
                            }
                        })
                    );
                }
            } else if (res.cluster.shards[0].high_availabilty) {
                console.log(`Number of live servers is: ${serversUp}, out of ${servers.length}`);
                console.log('read_system_res high_availabilty status is: ', res.cluster.shards[0].high_availabilty);
                saveErrorAndResume(`Error! Cluster is highly available when most servers are down!!`);
                failures_in_test = true;
            } else {
                console.log(`Cluster is not highly available as should!!`);
            }
        });
}

function checkServersStatus(read_system_res, servers, masterSecret, masterIndex) {
    console.log(`Checking the servers status`);
    const serversBySecret = _.groupBy(read_system_res.cluster.shards[0].servers, 'secret');
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
            // console.log(read_system_res.cluster.shards[0]);
        }
        return masterIndex;
    });
}

async function checkClusterStatus(servers, oldMasterNumber) {
    let oldSecret = 0;
    let isMasterDown = false;
    let masterIndex = oldMasterNumber;
    let connectedServers = [];
    console.log(servers);
    const old_master_status = await azf.getMachineStatus(servers[oldMasterNumber].name);
    if (oldMasterNumber > -1) {
        oldSecret = servers[oldMasterNumber].secret;
        if (old_master_status !== 'VM running') {
            isMasterDown = true;
        }
        console.log(`${YELLOW}Previous master is ${servers[oldMasterNumber].name}, status: ${
            old_master_status}${NC}`);
    } else {
        console.log(`${YELLOW}Previous master is undeceive - too much servers were down${NC}`);
    }

    console.log('Is master changed: ', isMasterDown);
    const vm_list = await azf.listVirtualMachines('Server', 'VM running'); //Not sure why we do this (LM 27/11/2017)
    if (isMasterDown === true) {
        const connectedMaster = vm_list[0];
        masterIndex = servers.findIndex(server => server.name === connectedMaster);
    } else {
        console.log(servers);
        masterIndex = oldMasterNumber;
    }
    servers.forEach(server => {
        if (server.status === 'CONNECTED') {
            connectedServers.push(server.name);
        }
    });
    console.log('Master index is ', masterIndex, 'Master ip is ', servers[masterIndex].ip);
    if (connectedServers.length > 0) {
        master_ip = servers[masterIndex].ip.trim();
        s3ops = new S3OPS({ ip: master_ip });
        console.log('Master ip', master_ip);
        rpc = api.new_rpc('wss://' + master_ip + ':8443');
        client = rpc.new_client({});
        let auth_params = {
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        };
        try {
            await client.create_auth_token(auth_params);
            console.log(`Waiting on read system`);
            const read_system_res = await client.system.read_system({});
            let masterSecret = read_system_res.cluster.master_secret;
            isSecretChanged(isMasterDown, oldSecret, masterSecret);
            checkClusterHAReport(connectedServers, servers);
            checkServersStatus(read_system_res, servers, masterSecret);
            if (failures_in_test && breakonerror) {
                throw new Error('Error in test - breaking the test');
            }
            // master_ip = servers[masterIndex].ip;
            rpc.disconnect_all();
            return master_ip;
        } catch (err) {
            if (rpc) rpc.disconnect_all();
            throw err;
        }
    } else {
        console.log('Most of the servers are down - Can\'t check cluster status');
        return -1;
    }
}

async function startVirtualMachineWithStatus(index, srv_timeout) {
    await azf.startVirtualMachine(cluster_servers[index].name);
    // test s3 service on the started server and also all other connected servers
    const connected_servers = cluster_servers.filter(server => (server.status === 'CONNECTED'));
    connected_servers.push(cluster_servers[index]);
    console.log('Waiting for all online servers to have working S3 service.', connected_servers);
    await P.map(_.uniqBy(connected_servers, 'ip'),
        server => wait_for_s3_service(server, srv_timeout)
        .catch(err => console.warn('failed waiting for S3 service. continue anyway..', err.message))
    );
}

async function wait_for_s3_service(server, srv_timeout) {
    let srv_s3ops = new S3OPS({ ip: server.ip });
    let start_time;
    let done = false;
    while (!done) {
        const status = await azf.getMachineStatus(server.name);
        if (status === 'VM running') {
            start_time = start_time || Date.now();
            server.status = 'CONNECTED';
            try {
                await srv_s3ops.test_s3_put(20000, server.name);
                done = true;
                const time_to_serve = (Date.now() - start_time) / 1000;
                console.log(`server ${server.name} is started and responding on S3 requests`, `took ${time_to_serve} seconds to start serving after startup`);
            } catch (err) {
                // stop testing after timeout
                if (Date.now() - start_time > srv_timeout * 1000) {
                    console.error(`Timeout: waiting for server ${server.name} [${server.ip}] timed out after ${srv_timeout} seconds`);
                    throw err;
                } else {
                    console.log(`server ${server.name} is up but S3 service is still unavailable..`);
                    await P.delay(5 * 1000);
                }
            }
        } else {
            console.log(`server ${server.name} is still booting`);
            await P.delay(10 * 1000);
        }
    }
}

async function stopVirtualMachineWithStatus(index, time) {
    await azf.stopVirtualMachine(cluster_servers[index].name);
    let done = false;
    while (!done) {
        const status = await azf.getMachineStatus(cluster_servers[index].name);
        console.log(status);
        if (status === 'VM stopped') {
            done = true;
            cluster_servers[index].status = 'DISCONNECTED';
            await delayInSec(time);
        } else {
            await P.delay(10 * 1000);
        }
    }
}

function setNTPConfig(serverIndex) {
    rpc = api.new_rpc('wss://' + cluster_servers[serverIndex].ip + ':8443');
    client = rpc.new_client({});
    console.log('Secret is ', cluster_servers[serverIndex].secret, 'for server ip ', cluster_servers[serverIndex].ip);
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
                target_secret: cluster_servers[serverIndex].secret,
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
    return P.map(requestedServers, async server => {
        try {
            const new_secret = await azf.createServer({
                serverName: server.name,
                vnet,
                storage,
                ipType: 'Static',
                createSystem: true
            });
            console.log(`${YELLOW}${server.name} secret is: ${new_secret}${NC}`);
            server.secret = new_secret;
            const ip = await azf.getIpAddress(server.name + '_pip');
            console.log(`${YELLOW}${server.name} and ip is: ${ip}${NC}`);
            server.ip = ip;
            if (!_.isUndefined(upgrade_pack)) {
                return srv_ops.upload_and_upgrade(ip, upgrade_pack);
            }
        } catch (err) {
            saveErrorAndResume('Can\'t create server and upgrade servers', err);
            failures_in_test = true;
            throw err;
        }
    });
}

function delayInSec(sec) {
    console.log(`Waiting ${sec} seconds for cluster to stable...`);
    return P.delay(sec * 1000);
}

function createCluster(requestedServes, masterIndex, clusterIndex) {
    const masterIp = requestedServes[masterIndex].ip;
    const slave_ip = requestedServes[clusterIndex].ip;
    const slave_secret = requestedServes[clusterIndex].secret;
    const slave_name = requestedServes[clusterIndex].name;
    const master_name = requestedServes[masterIndex].name;
    console.log(`${YELLOW}adding ${slave_name} to master: ${master_name}${NC}`);
    return azf.addServerToCluster(masterIp, slave_ip, slave_secret, slave_name)
        .then(() => delayInSec(90));
}

function verifyS3Server(topic) {
    console.log(`starting the verify s3 server on `, master_ip);
    let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
    return s3ops.create_bucket(bucket)
        .then(() => s3ops.get_list_buckets())
        .then(res => {
            if (res.includes(bucket)) {
                report.success(`create bucket${topic ? ' ' + topic : ''}`);
                console.log('Bucket is successfully added');
            } else {
                report.fail(`create bucket${topic ? ' ' + topic : ''}`);
                saveErrorAndResume(`Created bucket ${master_ip} bucket is not returns on list`, res);
            }
        })
        .then(() => s3ops.put_file_with_md5(bucket, '100MB_File', 100, 1048576)
            .then(() => s3ops.get_file_check_md5(bucket, '100MB_File')))
        .then(() => report.success(`ul and verify obj${topic ? ' ' + topic : ''}`))
        .catch(err => {
            report.fail(`ul and verify obj${topic ? ' ' + topic : ''}`);
            saveErrorAndResume(`${master_ip} FAILED verification s3 server`, err);
            failures_in_test = true;
            throw err;
        });
}

//const timeInMin = timeout * 1000 * 60;
console.log(`${YELLOW}Timeout: ${timeout} min${NC}`);
let masterIndex = 0;
console.log('Breaking on error?', breakonerror);

function checkAddClusterRules() {
    return createCluster(cluster_servers, masterIndex, 1)
        .catch(err => {
            if (err.message.includes('Could not add members when NTP is not set')) {
                report.success('Add member no NTP master');
                console.log(err.message, ' - as should');
            } else {
                report.fail('Add member no NTP master');
                saveErrorAndResume('Error is not returned when add cluster without set ntp in master');
            }
        })
        .then(() => setNTPConfig(0))
        .then(() => createCluster(cluster_servers, masterIndex, 1)
            .catch(err => {
                if (err.message.includes('Verify join conditions check returned NO_NTP_SET')) {
                    report.success('Add member no NTP 2nd');
                    console.log(err.message, ' - as should');
                } else {
                    report.fail('Add member no NTP 2nd');
                    console.warn('Error is not returned when add cluster without set ntp in in cluster server');
                }
            }));
}

function cleanEnv() {
    return P.map(cluster_servers, server => azf.deleteVirtualMachine(server.name)
            .catch(err => console.log(`Can't delete old server ${err.message}`)))
        .then(() => clean && process.exit(0));
}

async function runFirstFlow() {
    try {
        console.log(`${RED}<======= Starting first flow =======>${NC}`);
        await stopVirtualMachineWithStatus(1, 90);
        await verifyS3Server('one srv down');
        await startVirtualMachineWithStatus(1, 180);
        await verifyS3Server('all up after one down');
        await checkClusterStatus(cluster_servers, masterIndex);
        report.success('Stop/start same member');
    } catch (err) {
        report.fail('Stop/start same member');
        throw err;
    }
}

async function runSecondFlow() {
    try {
        console.log(`${RED}<==== Starting second flow ====>${NC}`);
        await stopVirtualMachineWithStatus(1, 90);
        await checkClusterStatus(cluster_servers, masterIndex);
        await verifyS3Server('one srv down');
        await stopVirtualMachineWithStatus(2, 180);
        let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));

        try {
            await s3ops.create_bucket(bucket);
            report.fail('succeeded config 2/3 down');
        } catch (err) {
            console.log(`Couldn't create bucket with 2 disconnected clusters - as should ${err.message}`);
            report.success('succeeded config 2/3 down');
        }

        // after returning from no service it takes longer for mongodb to be operational. wait up to 10 minutes
        await startVirtualMachineWithStatus(1, 600);
        await checkClusterStatus(cluster_servers, masterIndex);
        await verifyS3Server('one srv down after 2 down');
        await startVirtualMachineWithStatus(2, 180);
        await checkClusterStatus(cluster_servers, masterIndex);
        await verifyS3Server('all up after 2 down');
        report.success('Stop/start 2/3 of cluster');
    } catch (err) {
        report.fail('Stop/start 2/3 of cluster');
        throw err;
    }
}

async function runThirdFlow() {
    console.log(`${RED}<==== Starting third flow ====>${NC}`);
    try {
        await azf.stopVirtualMachine(cluster_servers[1].name);
        await azf.stopVirtualMachine(cluster_servers[2].name);
        cluster_servers[1].status = 'DISCONNECTED';
        cluster_servers[2].status = 'DISCONNECTED';
        await delayInSec(180);

        let bucket = 'new.bucket' + (Math.floor(Date.now() / 1000));
        try {
            await s3ops.create_bucket(bucket);
            report.fail('succeeded config 2/3 down');
        } catch (err) {
            console.log(`Couldn't create bucket with 2 disconnected clusters - as should ${err.message}`);
            report.success('succeeded config 2/3 down');
        }

        await azf.stopVirtualMachine(cluster_servers[0].name);
        cluster_servers[0].status = 'DISCONNECTED';
        await P.all([startVirtualMachineWithStatus(1, 600), startVirtualMachineWithStatus(2, 600)]);
        cluster_servers[1].status = 'CONNECTED';
        cluster_servers[2].status = 'CONNECTED';
        await checkClusterStatus(cluster_servers, masterIndex);
        report.success('stop all start two');

    } catch (err) {
        report.fail('stop all start two');
        throw err;
    }

    try {
        await verifyS3Server('one down after all down');
        await startVirtualMachineWithStatus(0, 180);
        await checkClusterStatus(cluster_servers, masterIndex);
        report.success('stop all start all');
    } catch (err) {
        report.fail('stop all start all');
        throw err;
    }

    await verifyS3Server('all up after all down');
}

function runForthFlow() {
    console.log(`${RED}<==== Starting forth flow ====>${NC}`);
    return stopVirtualMachineWithStatus(masterIndex, 90)
        .then(() => checkClusterStatus(cluster_servers, masterIndex))
        .then(() => report.success('stop master'))
        .catch(err => {
            report.fail('stop master');
            throw err;
        })
        .then(() => verifyS3Server('stop master'))
        .then(() => startVirtualMachineWithStatus(masterIndex, 180))
        .then(() => checkClusterStatus(cluster_servers, masterIndex))
        .then(() => report.success('stop/start master'))
        .catch(err => {
            report.fail('stop/start master');
            throw err;
        })
        .then(() => verifyS3Server('stop/start master'));
}

async function main() {
    try {
        await azf.authenticate();
        for (let i = 0; i < serversInCluster; ++i) {
            cluster_servers.push({
                name: prefix + i,
                secret: '',
                ip: '',
                status: 'CONNECTED'
            });
        }

        await cleanEnv();
        await prepareServers(cluster_servers);
        await checkAddClusterRules();
        await setNTPConfig(1);
        await createCluster(cluster_servers, masterIndex, 1);
        await setNTPConfig(2);
        await createCluster(cluster_servers, masterIndex, 2);
        await delayInSec(90);
        await checkClusterStatus(cluster_servers, masterIndex); //TODO: remove... ??
        await af.createRandomAgents(azf, master_ip, storage, vnet, agents_number, suffix, osesSet);
        await verifyS3Server('pre test');
        await checkClusterStatus(cluster_servers, masterIndex);
        await runFirstFlow();
        await runSecondFlow();
        await runThirdFlow();
        await runForthFlow();
        await af.clean_agents(azf, master_ip, suffix); //removing agents
        await cleanEnv();
    } catch (err) {
        console.error(`something went wrong ${err} ${errors}`);
        failures_in_test = true;
    }

    await report.report();

    if (failures_in_test) {
        console.error(`Errors during cluster test ${errors}`);
        process.exit(1);
    }
    console.log(`Cluster test was successful!`);
    process.exit(0);
}


if (require.main === module) {
    main();
}
