/* Copyright (C) 2016 NooBaa */
"use strict";

/**
 * This script is used as a part of the CI/CD process to run all Ceph S3 tests On NSFS standalone.
 * It creates the prior configuration needed.
 * In the past this script was a part of file test_ceph_s3.
 */

const fs = require('fs');
const path = require('path');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('test_ceph_s3');

const os_utils = require('../../../util/os_utils');
const config = require('../../../../config');
const mongo_utils = require('../../../util/mongo_utils');
const { CEPH_TEST, account_path, account_tenant_path, anonymous_account_path } = require('./test_ceph_s3_constants.js');
const nc_mkm = require('../../../manage_nsfs/nc_master_key_manager').get_instance();


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

    console.info('CEPH TEST CONFIGURATION:', JSON.stringify(CEPH_TEST));
    let access_keys = await get_access_keys(account_path);
    const access_key = access_keys.access_key;
    const secret_key = access_keys.secret_key;

    await os_utils.exec(`echo access_key = ${access_key} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    await os_utils.exec(`echo secret_key = ${secret_key} >> ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    access_keys = await get_access_keys(account_tenant_path);
    const access_key_tenant = access_keys.access_key;
    const secret_key_tenant = access_keys.secret_key;

    if (os_utils.IS_MAC) {
        await os_utils.exec(`sed -i "" "s|tenant_access_key|"${access_key_tenant}"|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i "" "s|tenant_secret_key|${secret_key_tenant}|g" ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);

    } else {
        await os_utils.exec(`sed -i -e 's:tenant_access_key:${access_key_tenant}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:tenant_secret_key:${secret_key_tenant}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_access_key:${access_key}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
        await os_utils.exec(`sed -i -e 's:s3_secret_key:${secret_key}:g' ${CEPH_TEST.test_dir}${CEPH_TEST.ceph_config}`);
    }
    // create anonymous account
    await create_anonymous_account();

}

async function get_access_keys(access_key_path) {
    const account_data = await fs.promises.readFile(access_key_path, 'utf8');
    const data_json = JSON.parse(account_data);
    const access_key = data_json.access_keys[0].access_key;
    const encrypted_secret_key = data_json.access_keys[0].encrypted_secret_key;
    const secret_key = await nc_mkm.decrypt(encrypted_secret_key, data_json.master_key_id);
    return {access_key, secret_key};
}

// Create an anonymous account for anonymous request. Use this account UID and GID for bucket access.
async function create_anonymous_account() {
    const nsfs_account_config = {
        uid: process.getuid(),
        gid: process.getgid(),
    };
    const { master_key_id } = await nc_mkm.encrypt_access_keys({});
    const data = {
        _id: mongo_utils.mongoObjectId(),
        name: config.ANONYMOUS_ACCOUNT_NAME,
        email: config.ANONYMOUS_ACCOUNT_NAME,
        nsfs_account_config: nsfs_account_config,
        access_keys: [],
        allow_bucket_creation: false,
        creation_date: new Date().toISOString(),
        master_key_id: master_key_id,
    };
    const account_data = JSON.stringify(data);
    await fs.promises.mkdir(path.dirname(anonymous_account_path));
    await fs.promises.writeFile(anonymous_account_path, account_data);
    console.log('Anonymous account created');
}

if (require.main === module) {
    main();
}
