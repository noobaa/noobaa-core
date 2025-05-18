/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_warp');
const argv = require('minimist')(process.argv.slice(2));
delete argv._;

const config = require('../../../../config');
const os_utils = require('../../../util/os_utils');
const { get_warp_access_keys } = require('./warp_utils');
const { DEFAULT_NUMBER_OF_WORKERS, WARP_TEST } = require('./warp_constants.js');

const usage = `
Usage:
--op                <mix>,<put>,<get>,...
                    warp operation to run, by default mix op is used
--concurrency       <integer>
                    set the number of workers to run the tests. 
--bucket            <string>
                    set the bucket name to run the tests on. by default the bucket name will not be set and warp will create the bucket.
--duration          <string>
                    set the duration of the tests. by default the duration is 10 minute.
                    example: 30s, 1m, 1h
--disable-multipart <boolean>
                    set to true to disable multipart upload. by default it is set to true.
--access-key        <string>
                    set the access key to use for the tests. by default it is set to $access_key.
--secret-key        <string> 
                    set the secret key to use for the tests. by default it is set to $secret_key.
--obj-size         <string>
                    set the object size to use for the tests. by default it is set to 1k.
                    example: 1k, 1m, 1g
--account-name      <string>
                    set the account name to use for the tests. by default it is set to warp_account.
`;

/**
 * main is the main function of the script.
 * @returns {Promise<Void>}
 */
async function main() {
    if (argv.help) print_usage();
    try {
        await run_warp();
    } catch (err) {
        console.error(`Warp Test Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

/**
 * print_usage prints the usage of the script.
 * @returns {Void}
 */
function print_usage() {
    console.log(usage);
    process.exit(0);
}

/**
 * run_warp runs the warp tests.
 * @returns {Promise<Void>}
 */
async function run_warp() {
    const op = argv.op || 'mixed';
    let access_key = argv.access_key;
    let secret_key = argv.secret_key;
    const account_name = argv.account_name || WARP_TEST.warp_account_params.name;
    const bucket = argv.bucket || WARP_TEST.warp_bucket_params.name;
    const obj_size = argv.obj_size || '1k';
    const duration = argv.duration || '10m';
    const number_of_workers = argv.concurrency || DEFAULT_NUMBER_OF_WORKERS;
    const disable_multipart = argv.disable_multipart || true;
    const endpoint = config.ENDPOINT_SSL_PORT;

    if (!account_name && !access_key && !secret_key) {
        console.error('Please provide account_name, access_key and secret_key');
        throw new Error('Please provide account_name or access_key and secret_key');
    }

    if (account_name && !access_key && !secret_key) {
        ({ access_key, secret_key } = await get_warp_access_keys(account_name));
    }

    // TODO - add --benchdata so that the result csv will be saved in logs
    // const warp_logs_dir = WARP_TEST.warp_logs_dir_path;
    const warp_command = `warp ${op} --host=localhost:${endpoint} --access-key=${access_key} --secret-key=${secret_key} --bucket=${bucket} --obj.size=${obj_size} --duration=${duration} --disable-multipart=${disable_multipart} --tls --insecure --concurrent ${number_of_workers}`;

    console.info(`Running warp ${warp_command}`);
    try {
        const warp_res = await os_utils.exec(warp_command, { ignore_rc: false, return_stdout: true });
        console.log('Finished Running Warp S3 Tests', warp_res);
    } catch (err) {
        console.error('Failed getting warp_res', err);
        throw new Error(`Failed getting warp_res ${err}`);
    }
}

if (require.main === module) {
    main();
}
