/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const util = require('util');
const api = require('../../api');
const crypto = require('crypto');
const P = require('../../util/promise');
const Report = require('../framework/report');
const config = require('../../../config');
const ssh_functions = require('../utils/ssh_functions');
const promise_utils = require('../../util/promise_utils');
const agent_functions = require('../utils/agent_functions');
const server_function = require('../utils/server_functions');
const AzureFunctions = require('../../deploy/azureFunctions');

require('../../util/dotenv').load();
const argv = require('minimist')(process.argv, { string: ['secret'] });


const TEST_CFG_DEFAULTS = {
    location: 'westus2',
    skipCreation: 'false',
    dummyPackagePath: '/tmp/two_step_test_dummy_package.tar.gz',
    dummyPackageJsonPath: '/tmp/package.json',
    serverName: 'upgradetestsrv'
};

let TEST_CFG = {};
let azure_functions;
let rpc;
let rpc_client;
let report;


/*
 * Helpers and util functions
 */
function usage() {
    console.log(`
    --resource          -   Resource group to create test env in, location will be ${TEST_CFG_DEFAULTS.location}
    --storage           -   Storage resource to use
    --skip_creation     -   Should the test skip creation of env, default is ${TEST_CFG_DEFAULTS.skipCreation}, if supplied --ip and --secret must be provided
    --upgrade_package   -   Path to the upgrade package to be used
    --vnet              -   vnet name for the environment
    --id                -   adding an id to the machine name.
    --ip / --secret     -   IP and Secret of the server, must be supplied if using the skip_creation options
    --help              -   show this help
    `);
}

const cases = [
    'blocked downgrade patch',
    'blocked downgrade minor',
    'blocked downgrade major',
    'non-package',
    'disk space',
    'time skew',
    'preconditions met',
    'stage package',
    'disk space 2nd step',
    'time skew 2nd step',
    'preconditions met 2nd step',
];
//Init Clients
function init_clients() {
    //Init ssh client and rpc client
    report = new Report();
    report.init_reporter({ suite: 'upgrade', conf: TEST_CFG, mongo_report: true, cases: cases });
    return ssh_functions.ssh_connect({
            host: TEST_CFG.ip,
            username: 'noobaaroot',
            password: TEST_CFG.secret,
            keepaliveInterval: 5000,
        })
        .then(client =>
            //Change cluster HB interval to 5sec instead of 60
            ssh_functions.ssh_exec(client, `sudo bash -c "sed -i 's:config.CLUSTER_HB_INTERVAL.*:config.CLUSTER_HB_INTERVAL = 5000:' /root/node_modules/noobaa-core/config.js"`)
            //TODO: change min size for upgrade instead of writing files...
            .then(() => ssh_functions.ssh_exec(client, `sudo bash -c "supervisorctl restart all"`))
            .delay(20000))
        .then(() => {
            rpc = api.new_rpc_from_base_address('wss://' + TEST_CFG.ip + ':8443', 'EXTERNAL');
            rpc_client = rpc.new_client({});
            let auth_params = {
                email: 'demo@noobaa.com',
                password: 'DeMo1',
                system: 'demo'
            };
            return rpc_client.create_auth_token(auth_params);
        });
}

//Verify all arguments were supplied and use defaults when can
function check_arguments_and_update() {
    if (argv.help) {
        usage();
        process.exit(1);
    }

    let error = 'Missing the following arguments:\n';
    let missing = false;
    if (!argv.vnet) {
        error += '  vnet\n';
        missing = true;
    }
    if (!argv.resource) {
        error += '  resource group\n';
        missing = true;
    }
    if (!argv.storage) {
        error += '  storage group\n';
        missing = true;
    }
    if (argv.skip_creation) {
        if (!argv.ip) {
            error += '  ip\n';
            missing = true;
        }
        if (!argv.secret) {
            error += '  secret\n';
            missing = true;
        }
    }
    if (!argv.upgrade_package) {
        error += '  upgrade_package\n';
        missing = true;
    }

    if (missing) {
        console.error(error);
        usage();
        process.exit(1);
    }

    //Init TEST_CFG
    TEST_CFG = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
    TEST_CFG.resourceGroup = argv.resource;
    TEST_CFG.storage = argv.storage;
    TEST_CFG.location = TEST_CFG_DEFAULTS.location;
    TEST_CFG.vnet = argv.vnet;
    TEST_CFG.upgrade_package = argv.upgrade_package;
    if (!argv.skipCreation) {
        TEST_CFG.ip = argv.ip;
        TEST_CFG.secret = argv.secret;
    }
    if (argv.id) {
        TEST_CFG.serverName = TEST_CFG_DEFAULTS.serverName + '-' + argv.id;
    }
}

/*
 * Receive expected upgrade status and failed condition, read_system until either one is met and fail/success
 * according to which one was reached
 */
async function _verify_upgrade_status(expected, failed, message, topic) {
    let reachedEndState = false;
    let success = true;
    let upgrade_status;
    while (!reachedEndState) {
        const read_system = await rpc_client.system.read_system();
        upgrade_status = read_system.cluster.shards[0].servers[0].upgrade;
        if (upgrade_status.status === failed) {
            reachedEndState = true;
            success = false;
        } else if (upgrade_status.status === expected) {
            reachedEndState = true;
        }
        await P.delay(2 * 1000);
    }
    console.log(`Verify Upgrade Status: Case "${message}", expected state ${expected} failure condition ${failed} received status ${util.inspect(upgrade_status)}`);
    if (success) {
        report.success(topic);
        return upgrade_status;
    } else {
        report.fail(topic);
        throw new Error(`Verify Upgrade Status ${message}`);
    }
}

async function _check_free_space_under_threshold() {
    let updated = false;
    let retries = 0;
    while (!updated) {
        const system_read = await rpc_client.system.read_system();
        const current_free_space = system_read.cluster.shards[0].servers[0].storage.free;
        if (current_free_space < config.MIN_MEMORY_FOR_UPGRADE) {
            console.log(`Current free space is ${current_free_space}`);
            updated = true;
        } else {
            retries += 1;
            if (retries === 18) {
                console.error(`Current free space is ${current_free_space}, Expected less then ${config.MIN_MEMORY_FOR_UPGRADE}`);
                throw new Error("For some reason local disk could not get filled! - stopping test");
            }
        }
        await P.delay(5 * 1000);
    }
}

/*
 * Fill local disk of the server to reach just below the min threshold for upgrade
 */
async function _fill_local_disk() {
    const read_system = await rpc_client.system.read_system();
    const free_server_space = read_system.cluster.shards[0].servers[0].storage.free;
    let size_to_write;
    if (free_server_space - config.MIN_MEMORY_FOR_UPGRADE > 0) {
        size_to_write = (free_server_space - config.MIN_MEMORY_FOR_UPGRADE) / 1024 / 1024; //Reach threshold
        size_to_write += 200; //Go over the threshold a little bit
        size_to_write = Math.floor(size_to_write);
    } else {
        //Already under the threshold
        size_to_write = 1;
    }
    const params = {
        ip: TEST_CFG.ip,
        secret: TEST_CFG.secret,
        sizeMB: size_to_write
    };
    console.log(`Filling ${(size_to_write / 1024).toFixed(2)}GB of server's local fisk, server reported disk free size is ${
        (free_server_space / 1024 / 1024 / 1024).toFixed(2)}GB`);
    await agent_functions.manipulateLocalDisk(params);
    await P.delay(10 * 1000);
    await _check_free_space_under_threshold();
}

/*
 * Verify we cannot downgrade from the current installed version :
 * X.Y.Z - Verify patch downgrade (Z), Minor (Y) and Major (X)
 * Per each test, generate a fake package.json file, pack it and upload to the server & verify failure
 */
function _verify_downgrade_fails() {
    let server_version;
    let test_version;

    return rpc_client.system.read_system()
        .then(res => {
            server_version = res.version.split('-')[0].split('.').map(str => Number(str));
            //If patch number is zero, nothing to check
            if (server_version[2] > 0) {
                test_version = `${server_version[0]}.${server_version[1]}.${server_version[2] - 1}`;
                fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackageJsonPath, JSON.stringify({ version: test_version }));
                return promise_utils.exec(`tar -zcvf ${TEST_CFG_DEFAULTS.dummyPackagePath} ${TEST_CFG_DEFAULTS.dummyPackageJsonPath}`)
                    .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath))
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (patch change)`, `blocked downgrade patch`));
            }
        })
        .then(() => {
            //If minor number is zero, nothing to check
            if (server_version[1] > 0) {
                test_version = `${server_version[0]}.${server_version[1] - 1}.${server_version[2]}`;
                fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackageJsonPath, JSON.stringify({ version: test_version }));
                return promise_utils.exec(`tar -zcvf ${TEST_CFG_DEFAULTS.dummyPackagePath} ${TEST_CFG_DEFAULTS.dummyPackageJsonPath}`)
                    .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath))
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (minor change)`, `blocked downgrade minor`));
            }
        })
        .then(() => {
            //If major number is zero, nothing to check
            if (server_version[0] > 0) {
                test_version = `${server_version[0] - 1}.${server_version[1]}.${server_version[2]}`;
                fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackageJsonPath, JSON.stringify({ version: test_version }));
                return promise_utils.exec(`tar -zcvf ${TEST_CFG_DEFAULTS.dummyPackagePath} ${TEST_CFG_DEFAULTS.dummyPackageJsonPath}`)
                    .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath))
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (major change)`,
                        `blocked downgrade major`));
            }
        })
        .catch(err => {
            console.error('Failed to verify downgrade failure with ', err);
            throw err;
        });
}

/*
 * Wrap around the change of ,upgrade_cluster from cluster_internal_api to upgrade_api
 * Once we have a base version with the changes, we can remove this func
 */
function _call_upgrade() {
    return rpc_client.upgrade.upgrade_cluster()
        .catch(err => {
            if (err.rpc_code === 'NO_SUCH_RPC_SERVICE') {
                console.log('Failed using upgrade.upgrade_cluster, using cluster_internal.upgrade_cluster', err.rpc_code);
                return rpc_client.cluster_internal.upgrade_cluster();
            } else {
                throw err;
            }
        });
}

/*
 * Test Skeleton/Flow
 */

//Create test environment
function create_env() {
    //Init AzureFunction
    azure_functions = new AzureFunctions(process.env.CLIENT_ID, process.env.DOMAIN,
        process.env.APPLICATION_SECRET, process.env.AZURE_SUBSCRIPTION_ID,
        TEST_CFG.resourceGroup, TEST_CFG.location);

    return azure_functions.authenticate()
        .then(() => azure_functions.createServer({
            serverName: TEST_CFG.serverName,
            vnet: TEST_CFG.vnet,
            storage: TEST_CFG.storage,
            latestRelease: true,
            createSystem: true
        }))
        .then(secret => {
            TEST_CFG.secret = secret;
            return azure_functions.getIpAddress(TEST_CFG.serverName + '_pip');
        })
        .then(ip => {
            TEST_CFG.ip = ip;
        });
}

//Test first stage of upgrade
async function test_first_step() {
    rpc.disable_validation();
    // Upload a non noobaa package & verify failure
    console.log('Upload a non noobaa package & verify failure..');
    let data = crypto.randomBytes(10 * 1024 * 1024);
    fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackagePath, data);
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath);
    await _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on random bytes package', `non-package`);
    await _verify_downgrade_fails();

    // Fill local disk & verify failure
    console.log('Fill local disk & verify failure..');
    await _fill_local_disk();
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    await _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on not enough disk space', `disk space`);
    console.log('clean local disk');
    await agent_functions.manipulateLocalDisk({ ip: TEST_CFG.ip, secret: TEST_CFG.secret });
    await P.delay(10000);

    // Create a time skew and verify failure
    console.log('Create a time skew and verify failure..');
    await rpc_client.cluster_server.update_time_config({
        target_secret: TEST_CFG.secret,
        timezone: "Asia/Jerusalem",
        epoch: 1514798132
    });
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    await _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on time skew', `time skew`);
    //Reset time back to normal
    await rpc_client.cluster_server.update_time_config({
        target_secret: TEST_CFG.secret,
        timezone: "Asia/Jerusalem",
        ntp_server: "time.windows.com"
    });
    await P.delay(65 * 1000);

    console.log('Verified all pre-condition tests, uploading package with optimal server state');
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    //All well, verify can upgrade
    await _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'All preconditions met, verify success', `preconditions met`);
    rpc.enable_validation();
}

async function test_second_step() {
    rpc.disable_validation();
    //TODO:: missing phone home connectivity test
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    await _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package before local disk', `stage package`);

    console.log('Full local disk & verify failure 2nd step');
    await _fill_local_disk();
    await P.delay(25 * 1000);
    await _call_upgrade();
    await _verify_upgrade_status('FAILED', 'SUCCESS', '2nd step of upgrade, verify failure on not enough local disk', `disk space 2nd step`);

    console.log('clean local disk 2nd step');
    await agent_functions.manipulateLocalDisk({ ip: TEST_CFG.ip, secret: TEST_CFG.secret });
    await P.delay(10 * 1000);
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    await _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package before time skew', `stage package`);

    console.log('verify fail on time skew 2nd step');
    await rpc_client.cluster_server.update_time_config({
        target_secret: TEST_CFG.secret,
        timezone: "Asia/Jerusalem",
        epoch: 1514798132
    });
    await _call_upgrade();
    await _verify_upgrade_status('FAILED', 'CAN_UPGRADE', '2nd step of upgrade, Verifying failure on time skew', `time skew 2nd step`);
    console.log('Reset time back to normal 2nd step');
    await rpc_client.cluster_server.update_time_config({
        target_secret: TEST_CFG.secret,
        timezone: "Asia/Jerusalem",
        ntp_server: "time.windows.com"
    });
    //time update restarts the services
    await P.delay(65 * 1000);
    await server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
    await _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package, final time', `preconditions met 2nd step`);
    await _call_upgrade();
    rpc.enable_validation();
    //NBNB need to wait for server and verify upgrade was successful
}

function run_test() {
    check_arguments_and_update(); //Verify all arguments exist

    return P.resolve()
        .then(() => {
            //Create env if not requested to skip
            if (argv.skip_creation) {
                return;
            }
            return create_env();
        })
        .then(() => init_clients())
        .then(() => test_first_step()) //Upload package, package validation & preconditions
        .tap(() => console.log(`Cleaning pre upgrade leftovers`))
        .then(() => server_function.clean_pre_upgrade_leftovers({ ip: TEST_CFG.ip, secret: TEST_CFG.secret }))
        .then(() => test_second_step()) //preconditions changed & upgrade itself
        .then(async () => {
            await report.report();
            console.log('two_step_upgrade_test passed');
            process.exit(0);
        })
        .catch(async function(err) {
            await report.report();
            console.error('error while running two_step_upgrade_test ', err);
            process.exit(2);
        });
}

run_test();
