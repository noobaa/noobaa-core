/* Copyright (C) 2025 NooBaa */
'use strict';

const child_process = require('child_process');
const util = require('util');

const async_exec = util.promisify(child_process.exec);

/**
 * run_go_sdk_v2_client_script will run the aws_sdkv2_client go script
 * @param {string} bucket_name
 * @param {string} key_name
 * @param {string} mpu_key_name
 * @param {string} endpoint
 */
async function run_go_sdk_v2_client_script(bucket_name, key_name, mpu_key_name, endpoint) {
   try {
      // check go version
      const res = await async_exec('go version');
      console.log('Go version', res.stdout.trim());

      // run the script
      const command_to_run_go_script = `go run ` +
         `./src/test/unit_tests/different_clients/go_aws_sdkv2_client.go ` +
         `-bucket ${bucket_name} -key ${key_name} -mpu ${mpu_key_name} -endpoint ${endpoint}`;
        const { stdout } = await async_exec(command_to_run_go_script, { env: { ...process.env } });
        return stdout;
     } catch (err) {
        console.log('go run exec failed with err:,', err);
        throw new Error(`go run script.go exec failed ${err.stderr || err.message}`);
     }
}

exports.run_go_sdk_v2_client_script = run_go_sdk_v2_client_script;
