/* Copyright (C) 2016 NooBaa */
"use strict";


const fs = require('fs');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);
if (argv.log_file) {
    dbg.set_log_to_file(argv.log_file);
}
dbg.set_process_name('test_ceph_s3');

const os_utils = require('../../util/os_utils');
const api = require('../../api');

// require('../../util/dotenv').load();


// create a global RPC client
// the client is used to perform setup operations on noobaa system
const rpc = api.new_rpc();
const client = rpc.new_client({
    address: `ws://${process.env.NOOBAA_MGMT_SERVICE_HOST}:${process.env.NOOBAA_MGMT_SERVICE_PORT}`
});

// const auth_params = { email, password: `${pass}`, system: `${system_name}` };

const CEPH_TEST = {
    test_dir: 'src/test/system_tests/',
    s3_test_dir: 's3-tests/',
    ceph_config: 'ceph_s3_config.conf',
    ceph_deploy: 'ceph_s3_tests_deploy.sh',
    pool: 'test-pool',
    new_account_params: {
        name: 'cephalt',
        email: 'ceph.alt@noobaa.com',
        //password: 'ceph',
        has_login: false,
        s3_access: true,
    },
    new_account_params_tenant: {
        name: 'cephtenant',
        email: 'ceph.tenant@noobaa.com',
        //password: 'ceph',
        has_login: false,
        s3_access: true,
    }
};

module.exports = {
    run_test: run_test
};

async function ceph_test_setup() {
    console.info(`Updating ${CEPH_TEST.ceph_config} with host = ${process.env.S3_SERVICE_HOST}...`);
    // update config with the s3 endpoint
    const conf_file = `${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`;
    const conf_file_content = (await fs.promises.readFile(conf_file)).toString();
    const new_conf_file_content = conf_file_content.replace(/host = localhost/g, `host = ${process.env.S3_SERVICE_HOST}`);
    await fs.promises.writeFile(conf_file, new_conf_file_content);
    console.log('conf file updated');

    //await test_utils.create_hosts_pool(client, CEPH_TEST.pool, 3);
    let system = await client.system.read_system();
    const internal_pool = system.pools.filter(p => p.resource_type === 'HOSTS')[0];
    console.log(internal_pool);
    try {
        await client.account.create_account({
            ...CEPH_TEST.new_account_params,
            default_resource: internal_pool.name
        });

        await client.account.create_account({
            ...CEPH_TEST.new_account_params_tenant,
            default_resource: internal_pool.name
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
    await os_utils.exec(`echo access_key = ${access_key.unwrap()} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    await os_utils.exec(`echo secret_key = ${secret_key.unwrap()} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    const { access_key: access_key_tenant, secret_key: secret_key_tenant } = ceph_account_tenant.access_keys[0];
    if (process.platform === 'darwin') {
        await os_utils.exec(`sed -i "" "s|tenant_access_key|${access_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|tenant_secret_key|${secret_key_tenant.unwrap()}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    } else {
        await os_utils.exec(`sed -i -e 's:tenant_access_key:${access_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:tenant_secret_key:${secret_key_tenant.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_access_key:${access_key.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_secret_key:${secret_key.unwrap()}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    }
}


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
        const auth_params = { email: process.env.email, password: process.env.password, system: 'noobaa' };
        await client.create_auth_token(auth_params);
    } catch (err) {
        console.error('Failed create auth token', err);
        throw new Error('Failed create auth token');
    }

    try {
        await ceph_test_setup();
    } catch (err) {
        console.error('Failed setup ceph tests', err);
        throw new Error('Failed setup ceph tests');
    }
}

if (require.main === module) {
    main();
}
