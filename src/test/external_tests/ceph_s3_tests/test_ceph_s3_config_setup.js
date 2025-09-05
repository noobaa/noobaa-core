/* Copyright (C) 2016 NooBaa */
"use strict";

/**
 * This script is used as a part of the CI/CD process to run all Ceph S3 tests.
 * It creates the prior configuration needed.
 * In the past this script was a part of file test_ceph_s3.
 */

const fs = require('fs');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_ceph_s3');

const os_utils = require('../../../util/os_utils');
const api = require('../../../api');
const { CEPH_TEST } = require('./test_ceph_s3_constants.js');
const { make_auth_token } = require('../../../server/common_services/auth_server');

// create a global RPC client
// the client is used to perform setup operations on noobaa system
const rpc = api.new_rpc();
const client = rpc.new_client({
    address: `${process.env.NOOBAA_MGMT_SERVICE_PROTO || 'ws'}://${process.env.NOOBAA_MGMT_SERVICE_HOST}:${process.env.NOOBAA_MGMT_SERVICE_PORT}`
});

async function main() {
    try {
        await run_test();
    } catch (err) {
        console.error(`Ceph Setup Failed: ${err}`);
        process.exit(1);
    }
    process.exit(0);
}

async function run_test() {
    try {
        // authenticate the client
        const auth_params = { email: process.env.email, system: 'noobaa', role: 'admin' };
        client.options.auth_token = make_auth_token(auth_params);
    } catch (err) {
        console.error('Failed create auth token', err);
        throw new Error('Failed create auth token');
    }

    try {
        await ceph_test_setup();
    } catch (err) {
        console.error('Failed setup Ceph tests', err);
        throw new Error('Failed setup Ceph tests');
    }
}

async function ceph_test_setup() {
    console.info(`Updating ${CEPH_TEST.ceph_config} with host = ${process.env.S3_SERVICE_HOST}...`);
    // update config with the s3 endpoint
    const conf_file = `${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`;
    const conf_file_content = (await fs.promises.readFile(conf_file)).toString();
    const new_conf_file_content = conf_file_content.replace(/host = localhost/g, `host = ${process.env.S3_SERVICE_HOST}`);
    await fs.promises.writeFile(conf_file, new_conf_file_content);
    console.log('conf file updated');

    let system = await client.system.read_system();
    // We are taking the first host pool, in normal k8s setup is default backing store 
    const test_pool = system.pools.filter(p => p.resource_type === 'HOSTS')[0];
    console.log(test_pool);
    try {
        await client.account.create_account({
            ...CEPH_TEST.new_account_params,
            default_resource: test_pool.name
        });

        await client.account.create_account({
            ...CEPH_TEST.new_account_params_tenant,
            default_resource: test_pool.name
        });
    } catch (err) {
        console.log("Failed to create account or tenant, assuming they were already created and continuing. ", err.message);
    }
    system = await client.system.read_system();
    const ceph_account = system.accounts.find(account =>
        account.email.unwrap() === CEPH_TEST.new_account_params.email
    );

    const ceph_account_tenant = system.accounts.find(account =>
        account.email.unwrap() === CEPH_TEST.new_account_params_tenant.email
    );

    console.info('CEPH TEST CONFIGURATION:', JSON.stringify(CEPH_TEST));
    const { access_key, secret_key } = ceph_account.access_keys[0];
    const { access_key: access_key_tenant, secret_key: secret_key_tenant } = ceph_account_tenant.access_keys[0];

    if (os_utils.IS_MAC) {
        await os_utils.exec(`sed -i "" "s|tenant_access_key|${access_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|tenant_secret_key|${secret_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|s3_access_key|${access_key.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|s3_secret_key|${secret_key.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    } else {
        await os_utils.exec(`sed -i -e 's:tenant_access_key:${access_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:tenant_secret_key:${secret_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_access_key:${access_key.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_secret_key:${secret_key.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    }
}

if (require.main === module) {
    main();
}
