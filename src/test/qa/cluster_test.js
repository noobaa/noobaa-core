/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const util = require('util');

const P = require('../../util/promise');
const af = require('../utils/agent_functions');
const api = require('../../api');
const dbg = require('../../util/debug_module')(__filename);
const argv = require('minimist')(process.argv);
const Report = require('../framework/report');
const srv_ops = require('../utils/basic_server_ops');
const server_functions = require('../utils/server_functions');
const { S3OPS } = require('../utils/s3ops');
const promise_utils = require('../../util/promise_utils');
const AzureFunctions = require('../../deploy/azureFunctions');


const testName = 'cluster_test';
let agents_prefix = testName.replace(/_test/g, '');
dbg.set_process_name(testName);

//define colors
const YELLOW = "\x1b[33;1m";
const RED = "\x1b[31m";
const NC = "\x1b[0m";


const clientId = process.env.CLIENT_ID;
const domain = process.env.DOMAIN;
const secret = process.env.APPLICATION_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const serversInCluster = argv.servers || 3;
let errors = [];
let cluster_servers = [];

const SECOND = 1000;
const MINUTE = 60 * SECOND;

let GRACE_PERIODS = {
    NO_GRACE: 0,
    DEFAULT_GRACE_PERIOD: 30 * SECOND,
    MEMBER_START_TIME_ON_HEALTHY_CLUSTER: 3 * MINUTE,
    AFTER_NO_SERVICE: 10 * MINUTE, // after returning from no service it takes longer for mongodb to be operational. wait up to 10 minutes
    FAIL_OVER_TIME: 2 * MINUTE,
    AGENTS_CONNECTION_TO_CLUSTER: 2 * MINUTE,
};



//defining the required parameters
const {
    location = 'westus2',
        configured_ntp = 'time.windows.com',
        configured_timezone = 'Asia/Jerusalem',
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
    agents_prefix = agents_prefix + '-' + id;
}

function usage() {
    console.log(`
    --location              -   azure location (default: ${location})
    --configured_ntp        -   ntp server (default: ${configured_ntp})
    --configured_timezone   -   time zone for the ntp (default: ${configured_timezone})
    --prefix                -   noobaa server prefix name (default: ${prefix})
    --resource              -   azure resource group
    --storage               -   azure storage on the resource group
    --vnet                  -   azure vnet on the resource group
    --id                    -   an id that is attached to the server names
    --upgrade_pack          -   location of the file for upgrade
    --agents_number         -   number of agents to add (default: ${agents_number})
    --servers               -   number of servers to create cluster from (default: ${serversInCluster})
    --clean                 -   will only delete the env and exit.
    --servers_json          -   skip servers creation. take servers information from given json file
    --long_grace            -   use long grace periods to ignore long failover\\startup times
    --help                  -   show this help
    `);
}

if (argv.help) {
    usage();
    process.exit(1);
}

if (argv.long_grace) {
    // use 1 hour as grace period for all scenarios
    console.log('using very long grace periods to avoid failing the test on long recovery times');
    GRACE_PERIODS = _.mapValues(GRACE_PERIODS, p => 60 * MINUTE);
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
    'list buckets pre test',
    'ul and verify obj pre test',
    'create bucket one srv down',
    'list buckets one srv down',
    'ul and verify obj one srv down',
    'create bucket all up after one down',
    'list buckets all up after one down',
    'ul and verify obj all up after one down',
    'create bucket one srv down after 2 down',
    'list buckets one srv down after 2 down',
    'ul and verify obj one srv down after 2 down',
    'create bucket all up after 2 down',
    'list buckets all up after 2 down',
    'ul and verify obj all up after 2 down',
    'create bucket one down after all down',
    'list buckets one down after all down',
    'ul and verify obj one down after all down',
    'create bucket all up after all down',
    'list buckets all up after all down',
    'ul and verify obj all up after all down',
    'create bucket stop master',
    'list buckets stop master',
    'ul and verify obj stop master',
    'create bucket stop/start master',
    'list buckets stop/start master',
    'ul and verify obj stop/start master',
];
report.init_reporter({ suite: testName, conf: { agents_number: agents_number }, mongo_report: true, cases: cases });


async function fail_test_on_error(message, err) {
    console.error(message, err || new Error('TEST_FAILED'));
    errors.push(message);
    await end_test(false);
}

console.log(`${YELLOW}resource: ${resource}, storage: ${storage}, vnet: ${vnet}${NC}`);
let azf = new AzureFunctions(clientId, domain, secret, subscriptionId, resource, location);


async function stop_server(server) {
    console.log(`stopping server ${server.name} (${server.ip})`);
    await azf.stopVirtualMachine(server.name);
    let done = false;
    const TIMEOUT = 5 * 60000; // wait up to 5 minutes for server to shutdown
    const start = Date.now();
    while (!done) {
        const status = await azf.getMachineStatus(server.name);
        console.log(status);
        if (status === 'VM stopped') {
            console.log(`server ${server.name} stopped`);
            done = true;
        } else {
            await P.delay(10 * 1000);
        }
        if (Date.now() - start > TIMEOUT) {
            await fail_test_on_error(`Failed to stop server ${server.name}`);
        }
    }
}

async function start_server(server) {
    console.log(`starting server ${server.name} (${server.ip})`);
    await azf.startVirtualMachine(server.name);
    let done = false;
    const TIMEOUT = 5 * 60000; // wait up to 5 minutes for server to shutdown
    const start = Date.now();
    while (!done) {
        const status = await azf.getMachineStatus(server.name);
        if (status === 'VM running') {
            console.log(`server ${server.name} started`);
            done = true;
        } else {
            await P.delay(10 * 1000);
        }
        if (Date.now() - start > TIMEOUT) {
            await fail_test_on_error(`Failed to start server ${server.name}`);
        }
    }
}

async function do_rpc(server, func) {
    if (!server.client) {
        server.rpc = api.new_rpc_from_base_address('wss://' + server.ip + ':8443', 'EXTERNAL');
        server.client = server.rpc.new_client({});
        await server.client.create_auth_token({
            email: 'demo@noobaa.com',
            password: 'DeMo1',
            system: 'demo'
        });
    }
    let retries = 0;
    while (retries < 3) {
        try {
            return func(server.client);
        } catch (err) {
            // if UNAUTHORIZED try to authenticate again
            if (err.rpc_code === 'UNAUTHORIZED') {
                retries += 1;
                server.rpc = api.new_rpc_from_base_address('wss://' + server.ip + ':8443', 'EXTERNAL');
                server.client = server.rpc.new_client({});
                await server.client.create_auth_token({
                    email: 'demo@noobaa.com',
                    password: 'DeMo1',
                    system: 'demo'
                });
            } else {
                throw err;
            }
        }
    }
    // rpc.disconnect_all();
    // return res;
}

async function set_time_manually(server) {
    console.log("Setting Time server manually");
    await do_rpc(server, async client => {
        await client.cluster_server.update_time_config({
            target_secret: server.secret,
            timezone: "GMT",
            epoch: 1549375240
        });
    });
}

async function set_ntp_config(server) {
    console.log('Secret is ', server.secret, 'for server ip ', server.ip);

    const MAX_RETRIES = 3;
    let done = false;
    let retries = 0;
    while (!done) {
        try {
            await do_rpc(server, async client => {
                await client.cluster_server.update_time_config({
                    target_secret: server.secret,
                    timezone: configured_timezone,
                    ntp_server: configured_ntp
                });
                console.log('Reading configuration');
                const result = await client.cluster_server.read_server_config({});
                let ntp = result.ntp_server;
                if (ntp === configured_ntp) {
                    console.log('The defined ntp is', ntp, '- as expected');
                } else {
                    throw new Error('The defined ntp is', ntp, '- failure!!!');
                }
            });
            done = true;
        } catch (err) {
            console.error('failed setting ntp:', err.message);
            if (retries < MAX_RETRIES) {
                console.warn('retry set_ntp in 5 seconds...');
                retries += 1;
                await P.delay(5000);
            } else {
                await fail_test_on_error('too many failures to set NTP', err);
            }
        }
    }
}

//this function is getting servers array creating and upgrading them.
function prepare_servers(requestedServers) {
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
            if (!_.isUndefined(upgrade_pack)) {
                await srv_ops.upload_and_upgrade(ip, upgrade_pack);
            }
            server.ip = ip;

            // remove swap on resource disk to speed up startup time of the machines during the test
            await server_functions.remove_swap_on_azure(server.ip, server.secret);
        } catch (err) {
            await fail_test_on_error(`failed to create and upgrade server ${server.name}`);
            throw err;
        }
    });
}

async function add_member(master, slave) {
    console.log(`${YELLOW}adding ${slave.name} to master: ${master.name}${NC}`);
    await server_functions.add_server_to_cluster(master.ip, slave.ip, slave.secret, slave.name);
    slave.rpc = null;
    slave.client = null;
}

async function verify_s3_server(server, topic) {
    console.log(`verifying s3 server on `, server.ip);
    const s3ops = new S3OPS({ ip: server.ip, suppress_long_errors: true });

    let bucket = `new.bucket-${server.ip}-${(Math.floor(Date.now() / 1000))}-${Math.floor(Math.random() * 100)}`;
    try {
        await s3ops.create_bucket(bucket);
    } catch (err) {
        err.failure_message = `failed to create bucket ${bucket} on endpoint ${server.ip} (${server.name})`;
        err.report_case = `create bucket${topic ? ' ' + topic : ''}`;
        throw err;
    }

    let bucket_list;
    try {
        bucket_list = await s3ops.get_list_buckets();
    } catch (err) {
        err.failure_message = `failed to create bucket ${bucket} on endpoint ${server.ip} (${server.name})`;
        err.report_case = `list bucket${topic ? ' ' + topic : ''}`;
        throw err;
    }

    if (!bucket_list.includes(bucket)) {
        const err = new Error();
        err.failure_message = `bucket ${bucket} was created on endpoint ${server.ip} (${server.name}) but is not returned by listBuckets`;
        err.report_case = `list bucket${topic ? ' ' + topic : ''}`;
        throw err;
    }

    let key = `100MB_File-${server.ip}-${Date.now()}`;
    try {
        await s3ops.put_file_with_md5(bucket, key, 5, 1048576);
        await s3ops.get_file_check_md5(bucket, key);
    } catch (err) {
        err.failure_message = `failed to upload object ${key} to bucket ${bucket} on endpoint ${server.ip} (${server.name})`;
        err.report_case = `ul and verify obj${topic ? ' ' + topic : ''}`;
        throw err;
    }
    report.success(`create bucket${topic ? ' ' + topic : ''}`);
    report.success(`ul and verify obj${topic ? ' ' + topic : ''}`);
}

// test that adding a member is failing when preconditions are not met
async function test_cluster_preconditions_failure() {
    console.log(`${RED}<======= test that add_member is failing when preconditions are not met =======>${NC}`);
    try {
        await set_time_manually(cluster_servers[0]);
        await set_time_manually(cluster_servers[1]);
        await add_member(cluster_servers[0], cluster_servers[1]);
    } catch (err) {
        // TODO: find a better way to verify the returned error - the error message is not promised to stay the same
        if (err.message.includes('Could not add members when NTP is not set')) {
            report.success('Add member no NTP master');
            console.log(err.message, ' - as expected');
        } else {
            report.fail('Add member no NTP master');
            await fail_test_on_error('add_member should fail when NTP is not set on master', err);
        }
    }

    await set_ntp_config(cluster_servers[0]);

    try {
        await add_member(cluster_servers[0], cluster_servers[1]);
    } catch (err) {
        if (err.message.includes('Verify join conditions check returned NO_NTP_SET')) {
            report.success('Add member no NTP 2nd');
            console.log(err.message, ' - as expected');
        } else {
            report.fail('Add member no NTP 2nd');
            await fail_test_on_error('add_member should fail when NTP is not set the added member', err);
        }
    }
}

function clean_env() {
    const agents_names = _.times(agents_number, i => `${agents_prefix}${i}`);
    const machines = cluster_servers.map(srv => srv.name).concat(agents_names);
    return P.map(machines, machine_name => azf.deleteVirtualMachine(machine_name)
            .catch(err => console.error(`failed to delete virtual machine ${machine_name}. ${err.message}`)))
        .then(() => clean && process.exit(0));
}


function set_all_servers_expected_status(servers, status) {
    for (const server of servers) {
        server.expected_status = status;
    }
}

async function test_stop_start_one_secondary(servers) {
    try {
        console.log(`${RED}<======= Test stop and start one secondary member =======>${NC}`);
        // validate cluster status
        set_all_servers_expected_status(servers, 'CONNECTED');
        await check_cluster_status(servers, {
            grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
        });
        const stopped_server = get_secondaries(servers)[0];
        console.log(`Stopping server ${stopped_server.name} (${stopped_server.ip})`);
        await stop_server(stopped_server);
        console.log(`server ${stopped_server.name} is down`);
        set_all_servers_expected_status(servers, 'CONNECTED');
        stopped_server.expected_status = 'DISCONNECTED';
        await P.all([
            check_cluster_status(servers, {
                grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
            }),
            // other endpoints should answer right away. no grace_period
            check_endpoint_status(servers, 'one srv down', { grace_period: GRACE_PERIODS.NO_GRACE })
        ]);
        await start_server(stopped_server);
        set_all_servers_expected_status(servers, 'CONNECTED');
        const grace_period = GRACE_PERIODS.MEMBER_START_TIME_ON_HEALTHY_CLUSTER;
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'all up after one down', { grace_period })
        ]);
        report.success('Stop/start same member');
        console.log(`${RED}<======= Test stop and start one secondary member PASSED =======>${NC}`);
    } catch (err) {
        report.fail('Stop/start same member');
        await fail_test_on_error('failed test_stop_start_one_secondary', err);
    }
}

async function test_stop_start_two_secondaries(servers) {
    try {
        console.log(`${RED}<==== Test stop and start two secondary members ====>${NC}`);

        // validate cluster status
        set_all_servers_expected_status(servers, 'CONNECTED');
        await check_cluster_status(servers, {
            grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
        });
        const secondaries = get_secondaries(servers);
        const master = get_master(servers);
        console.log(`Stopping servers ${secondaries.map(s => _.pick(s, 'name', 'ip'))}`);
        await P.map(secondaries, s => stop_server(s));
        console.log(`servers ${secondaries.map(s => _.pick(s, 'name', 'ip'))} are down`);

        // make sure master endpoint is not functioning
        const s3ops = new S3OPS({ ip: master.ip, suppress_long_errors: true });
        let bucket = 'bucket.should.not.be.created.' + (Math.floor(Date.now() / 1000));
        try {
            await s3ops.create_bucket(bucket);
            report.fail('succeeded config 2/3 down');
        } catch (err) {
            console.log(`Couldn't create bucket with 2 disconnected clusters - as expected ${err.message}`);
            report.success('succeeded config 2/3 down');
        }


        // start one server and check status
        await start_server(secondaries[0]);
        let grace_period = GRACE_PERIODS.AFTER_NO_SERVICE;
        set_all_servers_expected_status(servers, 'CONNECTED');
        // only secondaries[1] should be down
        secondaries[1].expected_status = 'DISCONNECTED';
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'one srv down after 2 down', { grace_period })
        ]);


        await start_server(secondaries[1]);
        grace_period = GRACE_PERIODS.MEMBER_START_TIME_ON_HEALTHY_CLUSTER;
        // set started server to CONNECTED
        secondaries[1].expected_status = 'CONNECTED';
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'all up after 2 down', { grace_period })
        ]);

        report.success('Stop/start 2/3 of cluster');
        console.log(`${RED}<==== Test stop and start two secondary members PASSED ====>${NC}`);
    } catch (err) {
        report.fail('Stop/start 2/3 of cluster');
        await fail_test_on_error('failed test_stop_start_two_secondaries', err);
    }
}

async function test_stop_all_start_all(servers) {
    let master;
    let secondaries;
    try {
        console.log(`${RED}<==== Test stop all members than start gradually ====>${NC}`);

        // validate cluster status
        set_all_servers_expected_status(servers, 'CONNECTED');
        await check_cluster_status(servers, {
            grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
        });

        secondaries = get_secondaries(servers);
        master = get_master(servers);
        console.log(`Stopping servers ${secondaries.map(s => _.pick(s, 'name', 'ip'))}`);
        await P.map(secondaries, s => stop_server(s));
        console.log(`servers ${secondaries.map(s => _.pick(s, 'name', 'ip'))} are down`);

        // make sure master endpoint is not functioning
        const s3ops = new S3OPS({ ip: master.ip, suppress_long_errors: true });
        let bucket = 'bucket.should.not.be.created.' + (Math.floor(Date.now() / 1000));
        try {
            await s3ops.create_bucket(bucket);
            report.fail('succeeded config 2/3 down');
        } catch (err) {
            console.log(`Couldn't create bucket with 2 disconnected clusters - as expected ${err.message}`);
            report.success('succeeded config 2/3 down');
        }

        // stop the master
        await stop_server(master);

        // start "secondaries". they should vote on a new master and cluster status should be ok
        await P.map(secondaries, srv => start_server(srv));
        set_all_servers_expected_status(servers, 'CONNECTED');
        // set only previous master to DISCONNECTED
        master.expected_status = 'DISCONNECTED';
        // after returning from no service it takes longer for mongodb to be operational. wait up to 10 minutes
        const grace_period = GRACE_PERIODS.AFTER_NO_SERVICE;
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'one down after all down', { grace_period })
        ]);

        report.success('stop all start two');
    } catch (err) {
        report.fail('stop all start two');
        await fail_test_on_error('failed test_stop_all_start_all after starting 2 servers', err);
    }
    try {
        await start_server(master);
        const grace_period = GRACE_PERIODS.MEMBER_START_TIME_ON_HEALTHY_CLUSTER;
        // set all servers to CONNECTED
        set_all_servers_expected_status(servers, 'CONNECTED');
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'all up after all down', { grace_period })
        ]);

        report.success('stop all start all');
        console.log(`${RED}<==== Test stop all members than start gradually PASSED ====>${NC}`);
    } catch (err) {
        report.fail('stop all start all');
        await fail_test_on_error('failed test_stop_all_start_all after starting all servers', err);
    }
}


async function test_stop_start_master(servers) {
    console.log(`${RED}<==== Test stop and start master ====>${NC}`);
    let master;
    try {
        // validate cluster status
        set_all_servers_expected_status(servers, 'CONNECTED');
        await check_cluster_status(servers, {
            grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
        });
        master = get_master(servers);
        console.log(`Stopping master ${master.name} (${master.ip})`);
        await stop_server(master);
        set_all_servers_expected_status(servers, 'CONNECTED');
        master.expected_status = 'DISCONNECTED';
        console.log(`master ${master.name} is down`);
        // grace period for failover is 2 minutes
        const grace_period = GRACE_PERIODS.FAIL_OVER_TIME;
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers.filter(srv => srv !== master), 'stop master', { grace_period })
        ]);
        report.success('stop master');
    } catch (err) {
        report.fail('stop master');
        await fail_test_on_error('failed test_stop_master after stopping master', err);
    }

    try {
        await start_server(master);
        const grace_period = GRACE_PERIODS.MEMBER_START_TIME_ON_HEALTHY_CLUSTER;
        set_all_servers_expected_status(servers, 'CONNECTED');
        await P.all([
            check_cluster_status(servers, {
                grace_period
            }),
            check_endpoint_status(servers, 'stop/start master', { grace_period })
        ]);
        report.success('Stop/start same member');
        console.log(`${RED}<==== Test stop and start master ====>${NC}`);
    } catch (err) {
        report.fail('stop/start master');
        await fail_test_on_error('failed test_stop_master after starting master', err);
    }
}


async function read_system_on_server(server, timeout) {
    const READ_SYSTEM_TIMEOUT = timeout || 30000;
    const machine_status = await azf.getMachineStatus(server.name);
    if (machine_status === 'VM running') {
        return do_rpc(server, async client => {
            console.log(`calling read_system on ${server.ip}`);
            console.time(`${server.ip} read_system`);
            const res = await P.resolve()
                .then(() => client.system.read_system({}))
                .timeout(READ_SYSTEM_TIMEOUT);
            console.timeEnd(`${server.ip} read_system`);
            return res;
        });
    }

}


async function read_system_on_servers(servers, timeout) {
    return P.map(servers, async server => {
        try {
            server.last_read_system = await read_system_on_server(server);
            return server.last_read_system;
        } catch (err) {
            console.error(`failed read_system on ${server.ip}`, err.message);
            throw err;
        }
    });
}


function verify_servers_status(servers, srv) {
    const expected_statuses = servers.map(server => server.expected_status);
    const servers_by_secret = _.groupBy(srv.last_read_system.cluster.shards[0].servers, 'secret');
    if (_.some(servers_by_secret, group => group.length > 1)) {
        console.error(`server ${srv.name}[${srv.ip}] returned multiple servers with the same secret:`,
            util.inspect(servers_by_secret, { depth: 4 }));
        throw new Error(`server ${srv.name}[${srv.ip}] returned multiple servers with the same secret`);
    }
    const actual_statuses = servers.map(server => {
        let status = _.get(servers_by_secret, `${server.secret}.0.status`);
        if (!status) {
            console.error(`no status for server secret ${server.secret}. servers_by_secret =`, servers_by_secret);
        }
        return servers_by_secret[server.secret][0].status;
    });
    return {
        passed: _.isEqual(actual_statuses, expected_statuses),
        actual: actual_statuses,
        expected: expected_statuses,
        message: `Servers status returned by ${srv.name} should match expected`
    };
}

function verify_single_master(servers) {
    let expected_master_secret;
    // pick any existing master_secret
    servers.forEach(srv => {
        expected_master_secret = expected_master_secret ||
            (srv.last_read_system && srv.last_read_system.cluster.master_secret);
    });
    const expected_masters = servers.map(server => (server.expected_status === 'CONNECTED' ? expected_master_secret : undefined));
    const actual_masters = servers.map(server => _.get(server.last_read_system, 'cluster.master_secret'));
    return {
        passed: _.isEqual(expected_masters, actual_masters),
        actual: actual_masters,
        expected: expected_masters,
        message: 'All servers should agree on the same master'
    };
}

function verify_ha_reporting(servers, expected_ha) {
    const expected_ha_reports = servers.map(server => (server.expected_status === 'CONNECTED' ? expected_ha : undefined));
    const actual_ha = servers.map(server => server.last_read_system && server.last_read_system.cluster.shards[0].high_availabilty);
    return {
        passed: _.isEqual(expected_ha_reports, actual_ha),
        actual: actual_ha,
        expected: expected_ha_reports,
        message: `All servers should report high_availabilty=${expected_ha}`
    };
}

function verify_checks_preconditions(servers) {
    // first verify that all members that should be connected returned read_system
    servers.forEach(srv => {
        if (srv.expected_status === 'CONNECTED' && !srv.last_read_system) {
            throw new Error(`server ${srv.name} did not return read_system result`);
        }
    });
}

// eslint-disable-next-line no-unused-vars
function verify_agents_optimal(servers) {
    // TODO: check in read system that all hosts are optimal
}


async function check_cluster_status(servers, params = {}) {
    let res_time;
    const num_connected = servers.filter(server => server.expected_status === 'CONNECTED').length;
    const expected_ha = num_connected > (servers.length + 1) / 2;
    let cluster_checks_results = [];
    const grace_period = params.grace_period || GRACE_PERIODS.DEFAULT_GRACE_PERIOD;
    let done = false;
    console.log(`${YELLOW}=== Checking cluster status with grace time of ${grace_period / 1000} seconds ===${NC}`);
    const start_time = Date.now();
    while (!done) {
        cluster_checks_results = [];
        try {
            res_time = Date.now();
            await read_system_on_servers(servers, grace_period);

            verify_checks_preconditions(servers);

            // check servers status returned by each member
            for (const srv of servers) {
                if (srv.expected_status === 'CONNECTED') {
                    cluster_checks_results.push(verify_servers_status(servers, srv));
                }
            }
            cluster_checks_results.push(verify_single_master(servers));
            cluster_checks_results.push(verify_ha_reporting(servers, expected_ha));
            // TODO: cluster_checks_results.push(verify_agents_optimal(servers));

            // fail if not all checks passed
            if (cluster_checks_results.every(check => check.passed)) {
                done = true;
            } else {
                throw new Error('Failed cluster checks');
            }

            // set is_master flag on the master server
            servers.forEach(srv => {
                srv.is_master = srv.last_read_system && srv.secret === srv.last_read_system.cluster.master_secret;
            });
        } catch (err) {
            if (res_time - start_time > grace_period) {
                cluster_checks_results.forEach(check => {
                    if (check.passed) {
                        console.log(`Passed check: ${check.message}`,
                            `--- result: ${util.inspect(check.expected, {depth: 4})}`);
                    } else {
                        console.error(`Failed check: ${check.message}`,
                            `--- expected: ${util.inspect(check.expected, {depth: 4})}`,
                            `--- actual: ${util.inspect(check.actual, {depth: 4})}`);
                    }
                });
                await fail_test_on_error(`check_cluster_status failed on error after a grace_period of ${grace_period}`, err);
            } else {
                await P.delay(5000);
            }
        }
    }
    console.log(`${YELLOW}=== Cluster status is stable after ${(res_time - start_time) / 1000} seconds`,
        `(grace period was ${grace_period / 1000} seconds) ===${NC}`);

}

function get_master(servers) {
    return servers.find(srv => srv.is_master);
}

function get_secondaries(servers) {
    return servers.filter(srv => !srv.is_master);
}


async function wait_for_agents(servers, num_agents, grace_period) {
    const delay = 10000;
    // rough calculation - ignoring the time of read_system itself
    const attempts = grace_period / delay;
    const master = get_master(servers);
    try {
        await promise_utils.retry(attempts, delay, async () => {
            const read_system_res = await read_system_on_server(master);
            const optimal_agents = read_system_res.hosts.by_mode.OPTIMAL;
            if (optimal_agents === num_agents) {
                console.log(`All agents are online (${num_agents} agents)`);
            } else {
                console.log(`waiting for agents - ${optimal_agents} out of ${num_agents} are online..`);
                throw new Error(`not all agents are optimal (${optimal_agents} out of ${num_agents})`);
            }
        });
    } catch (err) {
        await fail_test_on_error(`Failed waiting for agents after a grace period of ${grace_period}`, err);
    }
}

async function check_endpoint_status(servers, topic, params = {}) {
    const { grace_period = 30000 } = params;
    console.log(`${YELLOW}=== Checking endpoints status with grace time of ${grace_period / 1000} seconds for test case: "${topic}" ===${NC}`);
    const delay = 5000;
    let res_time;
    const start_time = Date.now();
    await P.map(servers, async srv => {
        if (srv.expected_status !== 'CONNECTED') {
            console.log(`server ${srv.name} (${srv.ip}) is not expected to be connected. skipping endpoint check`);
            return;
        }
        let done = false;
        while (!done) {
            res_time = Date.now();
            try {
                await verify_s3_server(srv, topic);
                done = true;
            } catch (err) {
                if (res_time - start_time > grace_period) {
                    report.fail(err.report_case);
                    await fail_test_on_error(`check_endpoint_status on server ${srv.name} failed after a grace period of ${grace_period} ` +
                        `${err.failure_message}`, err);
                } else {
                    await P.delay(delay);
                }
            }
        }
    });
    console.log(`${YELLOW}=== Endpoints are operational after ${(res_time - start_time) / 1000} seconds`,
        `(grace period was ${grace_period / 1000} seconds) ===${NC}`);
}


async function end_test(is_successful) {
    await report.report();

    if (is_successful) {
        try {
            await clean_env(); //We will clean the env only if the test was successful
        } catch (err) {
            console.error('Failed cleaning environment:', err);
        }
        console.log(`Cluster test was successful!`);
        process.exit(0);
    } else {
        console.error(`Errors during cluster test ${errors}`);
        process.exit(1);
    }
}

async function main() {
    // disable dbg logs
    dbg.set_level(-1, 'core');

    try {
        await azf.authenticate();
        if (argv.servers_json) {
            cluster_servers = JSON.parse(await fs.readFileAsync(argv.servers_json));
        } else {
            for (let i = 0; i < serversInCluster; ++i) {
                cluster_servers.push({
                    index: i,
                    name: prefix + i,
                    secret: '',
                    ip: '',
                });
            }
            await clean_env();
            await prepare_servers(cluster_servers);
            if (argv.write_servers_json) {
                await fs.writeFileAsync(argv.write_servers_json, JSON.stringify(cluster_servers));
            }
        }



        console.log('Running cluster test on following servers:', cluster_servers);

        await test_cluster_preconditions_failure();

        console.log('======= set ntp configurations on all members and create cluster with 3 members =======');
        await set_ntp_config(cluster_servers[1]);
        await add_member(cluster_servers[0], cluster_servers[1]);
        await set_ntp_config(cluster_servers[2]);
        await add_member(cluster_servers[0], cluster_servers[2]);

        // ensure cluster status before adding agents
        for (const server of cluster_servers) server.expected_status = 'CONNECTED';
        await check_cluster_status(cluster_servers);

        await af.createRandomAgents(azf, get_master(cluster_servers).ip, storage, vnet, agents_number, agents_prefix, osesSet);
        await wait_for_agents(cluster_servers, agents_number, GRACE_PERIODS.AGENTS_CONNECTION_TO_CLUSTER);

        await check_endpoint_status(cluster_servers, 'pre test', {
            grace_period: GRACE_PERIODS.DEFAULT_GRACE_PERIOD
        });
        await test_stop_start_one_secondary(cluster_servers);
        await test_stop_start_two_secondaries(cluster_servers);
        await test_stop_all_start_all(cluster_servers);
        await test_stop_start_master(cluster_servers);
    } catch (err) {
        console.error(`something went wrong ${err} ${errors}`);
        await end_test(false);
    }
    await end_test(true);
}


if (require.main === module) {
    main();
}
