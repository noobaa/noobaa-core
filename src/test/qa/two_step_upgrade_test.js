/* Copyright (C) 2016 NooBaa */
'use strict';

const fs = require('fs');
const _ = require('lodash');
const util = require('util');
const api = require('../../api');
const crypto = require('crypto');
const P = require('../../util/promise');
const ssh_functions = require('../utils/ssh_functions');
const promise_utils = require('../../util/promise_utils');
const agent_functions = require('../utils/agent_functions');
const server_function = require('../utils/server_functions');
const AzureFunctions = require('../../deploy/azureFunctions');

require('../../util/dotenv').load();
const argv = require('minimist')(process.argv);


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

//Init Clients
function init_clients() {
    //Init ssh client and rpc client
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
            rpc = api.new_rpc('wss://' + TEST_CFG.ip + ':8443');
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
 * Recieve expected upgrade status and failed condition, read_system until either one is met and fail/success 
 * according to which one was reached
 */
function _verify_upgrade_status(expected, failed, message) {
    let reachedEndState = false;
    let success = true;
    let upgrade_status;
    return promise_utils.pwhile(() => !reachedEndState,
            () => rpc_client.system.read_system()
            .then(res => {
                upgrade_status = res.cluster.shards[0].servers[0].upgrade;
                if (upgrade_status.status === failed) {
                    reachedEndState = true;
                    success = false;
                } else if (upgrade_status.status === expected) {
                    reachedEndState = true;
                }
            })
            .delay(2000))
        .then(() => {
            console.log(`Verify Upgrade Status: Case "${message}", expected state ${expected} failure condition ${failed} recieved status ${util.inspect(upgrade_status)}`);
            if (success) {
                return upgrade_status;
            } else {
                throw new Error(`Verify Upgrade Status ${message}`);
            }
        });
}

/*
 * Fill local disk of the server to reach just below the min threshold for upgrade
 */
function _fill_local_disk() {
    const MIN_MEMORY_FOR_UPGRADE_MB = 1200 * 1024 * 1024;
    return rpc_client.system.read_system()
        .then(res => {
            const free_server_space = res.cluster.shards[0].servers[0].storage.free;
            let size_to_write;
            if (free_server_space - MIN_MEMORY_FOR_UPGRADE_MB > 0) {
                size_to_write = (free_server_space - MIN_MEMORY_FOR_UPGRADE_MB) / 1024 / 1024; //Reach threshold
                size_to_write += 10; //Go over the threshold a little bit
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
            console.log(`Filling ${(size_to_write / 1024).toFixed(2)}GB of server's local fisk`);
            return agent_functions.manipulateLocalDisk(params);
        })
        .delay(10000);
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
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (patch change)`));
            }
        })
        .then(() => {
            //If minor number is zero, nothing to check
            if (server_version[1] > 0) {
                test_version = `${server_version[0]}.${server_version[1] - 1}.${server_version[2]}`;
                fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackageJsonPath, JSON.stringify({ version: test_version }));
                return promise_utils.exec(`tar -zcvf ${TEST_CFG_DEFAULTS.dummyPackagePath} ${TEST_CFG_DEFAULTS.dummyPackageJsonPath}`)
                    .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath))
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (minor change)`));
            }
        })
        .then(() => {
            //If major number is zero, nothing to check
            if (server_version[0] > 0) {
                test_version = `${server_version[0] - 1}.${server_version[1]}.${server_version[2]}`;
                fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackageJsonPath, JSON.stringify({ version: test_version }));
                return promise_utils.exec(`tar -zcvf ${TEST_CFG_DEFAULTS.dummyPackagePath} ${TEST_CFG_DEFAULTS.dummyPackageJsonPath}`)
                    .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath))
                    .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', `Verifying blocked downgrade to ${test_version} (major change)`));
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
            latesetRelease: true,
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
function test_first_step() {
    rpc.disable_validation();
    return P.resolve()
        .then(() => { //Upload a non noobaa package & verify failure
            let data = crypto.randomBytes(10 * 1024 * 1024);
            fs.writeFileSync(TEST_CFG_DEFAULTS.dummyPackagePath, data);
            return server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG_DEFAULTS.dummyPackagePath);
        })
        .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on random bytes package'))
        .then(() => _verify_downgrade_fails()) //Test Failure on a downgrade noobaa package
        .then(() => _fill_local_disk() //Full local disk & verify failure
            .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package))
            .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on not enough disk space'))
            .then(() => agent_functions.manipulateLocalDisk({ ip: TEST_CFG.ip, secret: TEST_CFG.secret }))
            .delay(10000)) //clean local disk
        //No phone home connectivity test
        //.then(() => {
        //NBNB block phone home connectivity and test
        //_verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on blocked phone home connectivity))
        //        })
        //Create a time skew and verify failure
        .then(() => rpc_client.cluster_server.update_time_config({
                target_secret: TEST_CFG.secret,
                timezone: "Asia/Jerusalem",
                epoch: 1514798132
            })
            .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', 'Verifying failure on time skew'))
            //Reset time back to normal
            .then(() => rpc_client.cluster_server.update_time_config({
                target_secret: TEST_CFG.secret,
                timezone: "Asia/Jerusalem",
                ntp_server: "pool.ntp.org"
            }))
            .delay(25000)) //time update restarts the services
        .then(() => {
            console.log('Verified all pre-condition tests, uploading package with optimal server state');
            return server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package);
        })
        //All well, verify can upgrade
        .then(() => _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'All preconditions met, verify success'))
        .then(() => rpc.enable_validation());
}

function test_second_step() {
    //TODO:: missing phone home connectivity test
    return P.resolve()
        .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package))
        .then(() => _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package before local disk'))
        .then(() => _fill_local_disk() //Full local disk & verify failure
            .delay(10000)
            .then(() => _call_upgrade())
            .then(() => _verify_upgrade_status('FAILED', 'SUCCESS', '2nd step of upgrade, verify failure on not enough local disk'))
            .then(() => agent_functions.manipulateLocalDisk({ ip: TEST_CFG.ip, secret: TEST_CFG.secret }))
            .delay(10000)) //clean local disk
        .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package))
        .then(() => _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package before time skew'))
        //verify fail on time skew
        .then(() => rpc_client.cluster_server.update_time_config({
                target_secret: TEST_CFG.secret,
                timezone: "Asia/Jerusalem",
                epoch: 1514798132
            })
            .then(() => _call_upgrade())
            .then(() => _verify_upgrade_status('FAILED', 'CAN_UPGRADE', '2nd step of upgrade, Verifying failure on time skew'))
            //Reset time back to normal
            .then(() => rpc_client.cluster_server.update_time_config({
                target_secret: TEST_CFG.secret,
                timezone: "Asia/Jerusalem",
                ntp_server: "pool.ntp.org"
            }))
            .delay(65000)) //time update restarts the services
        .then(() => server_function.upload_upgrade_package(TEST_CFG.ip, TEST_CFG.upgrade_package))
        .then(() => _verify_upgrade_status('CAN_UPGRADE', 'FAILED', 'Staging package, final time'))
        .then(() => _call_upgrade());
    //NBNB need to wait for server and verify upgrade was successfull
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
        .then(() => test_second_step()) //preconditions changed & upgrade itself
        .then(() => {
            console.log('two_step_upgrade_test passed');
            process.exit(0);
        })
        .catch(function(err) {
            console.error('error while running two_step_upgrade_test ', err);
            process.exit(2);
        });
}

run_test();
