/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const api = require('../../api');
const P = require('../../util/promise');
const { S3OPS } = require('../utils/s3ops');
const Report = require('../framework/report');
const argv = require('minimist')(process.argv);
const dbg = require('../../util/debug_module')(__filename);

const test_name = 'accounts';
dbg.set_process_name(test_name);

let rpc;
let client;
let errors = [];
let failures_in_test = false;

const TEST_CFG_DEFAULTS = {
    mgmt_ip: '',
    mgmt_port_https: '',
    s3_ip: '',
    s3_port: '',
    name: 'account',
    bucket: 'first.bucket',
    emailSuffix: '@email.email',
    password: 'Password',
    s3_access: true, //TODO: this is a bug, we will not ve able to change it (argv changes from false to true only)
    cycles: 15,
    accounts_number: 2,
    skip_report: false,
    skip_delete: false,
    skip_create: false
};

if (argv.help) {
    usage();
    process.exit(3);
}

//define colors
const YELLOW = "\x1b[33;1m";
// const RED = "\x1b[31m";
const NC = "\x1b[0m";

let TEST_CFG = _.defaults(_.pick(argv, _.keys(TEST_CFG_DEFAULTS)), TEST_CFG_DEFAULTS);
Object.freeze(TEST_CFG);

let report = new Report();

function usage() {
    console.log(`
    --mgmt_ip           -   noobaa management ip.
    --mgmt_port_https   -   noobaa server management https port
    --s3_ip             -   noobaa s3 ip
    --s3_port           -   noobaa s3 port
    --name              -   account prefix (default: ${TEST_CFG_DEFAULTS.name})
    --bucket            -   bucket name (default: ${TEST_CFG_DEFAULTS.bucket})
    --emailSuffix       -   The email suffix (default: ${TEST_CFG_DEFAULTS.emailSuffix})
    --password          -   Account's Password (default: ${TEST_CFG_DEFAULTS.password})
    --s3_access         -   should we have s3 access (default: ${TEST_CFG_DEFAULTS.s3_access})
    --cycles            -   number of cycles (default: ${TEST_CFG_DEFAULTS.cycles})
    --accounts_number   -   number of accounts to create per cycle (default: ${TEST_CFG_DEFAULTS.accounts_number})
    --skip_report       -   will skip sending report to mongo
    --skip_delete       -   should we delete the accounts (default: ${TEST_CFG_DEFAULTS.skip_delete})
    --skip_create       -   Skip creating accounts (default: ${TEST_CFG_DEFAULTS.skip_create})
    --help              -   show this help
    `);
}

//Define test cases
const cases = [
    'create_account',
    'delete_account',
    'regenerate_s3Access',
    'edit_s3Access',
    'edit_bucket_creation',
    'restrict_ip_access',
    'reset_password'
];
report.init_reporter({ suite: test_name, conf: TEST_CFG, mongo_report: true, cases: cases });

function saveErrorAndResume(message) {
    console.error(message);
    errors.push(message);
}

async function get_accounts_emails() {
    try {
        const system_info = await client.system.read_system();
        const emails = system_info.accounts.map(account => account.email);
        console.log("Accounts list: " + emails);
        return emails;
    } catch (err) {
        console.error('Get account list failed!', err);
        throw err;
    }
}

async function get_s3_account_access(email) {
    try {
        const system_info = await client.system.read_system();
        const accounts = system_info.accounts;
        const account = _.find(accounts, accountObj => accountObj.email === email);
        const s3AccessKeys = {
            accessKeyId: account.access_keys[0].access_key,
            secretAccessKey: account.access_keys[0].secret_key,
            access: account.has_s3_access
        };
        console.log("S3 access keys: " + s3AccessKeys.accessKeyId, s3AccessKeys.secretAccessKey);
        return s3AccessKeys;
    } catch (err) {
        console.error('Getting s3 access keys return error: ', err);
        throw err;
    }
}

async function get_account_create_bucket_status(email) {
    try {
        const system_info = await client.system.read_system();
        const accounts = system_info.accounts;
        const account = _.find(accounts, accountObj => accountObj.email === email);
        return account.can_create_buckets;
    } catch (err) {
        console.error('Getting create bucket status return error: ', err);
        throw err;
    }
}

function get_allowed_buckets(s3_access) {
    if (s3_access === true) {
        return {
            full_permission: true,
            permission_list: undefined
        };
    } else {
        return undefined;
    }
}

function set_account_details(has_login, account_name, email, s3_access) {
    const allowed_buckets = get_allowed_buckets(s3_access);
    return {
        name: account_name,
        email,
        password: TEST_CFG.password,
        has_login,
        s3_access: TEST_CFG.s3_access,
        allowed_buckets,
        default_pool: 'first-pool'
    };
}

async function create_account(has_login, account_name) {
    //building an account parameters object.
    console.log(`Creating account: ${account_name} with access login: ${has_login} s3 access: ${TEST_CFG.s3_access}`);
    let email = account_name + TEST_CFG.emailSuffix;
    let accountData = set_account_details(has_login, account_name, email, TEST_CFG.s3_access);
    try {
        await client.account.create_account(accountData);
        await report.success('create_account');
        return accountData.email;
    } catch (err) {
        report.fail('create_account');
        console.error('Creating account Failed with error: ', err);
        throw err;
    }
}

async function delete_account(email) {
    console.log('Deleting account: ' + email);
    try {
        await client.account.delete_account({
            email: email
        });
        await report.success('delete_account');
    } catch (err) {
        report.fail('delete_account');
        console.error('Deleting account Failed with error: ', err);
        throw err;
    }
}

async function regenerate_s3Access(email) {
    console.log('Regenerating account keys: ' + email);
    try {
        await client.account.generate_account_keys({
            email,
            verification_password: 'DeMo1'
        });
        await report.success('regenerate_s3Access');
    } catch (err) {
        report.fail('regenerate_s3Access');
        console.error('Regenerating account keys Failed with error: ', err);
        throw err;
    }
}

async function edit_s3Access(email, s3_access) {
    console.log(`Editing account s3 access: ${email} with access to bucket ${s3_access}`);
    const allowed_buckets = get_allowed_buckets(s3_access);
    try {
        await client.account.update_account_s3_access({
            email,
            s3_access,
            allowed_buckets,
            default_pool: 'first-pool'
        });
        await report.success('edit_s3Access');
    } catch (err) {
        report.fail('edit_s3Access');
        console.error('Editing access Failed with error: ', err);
        throw err;
    }
}

async function edit_bucket_creation(email, allow_bucket_creation) {
    if (allow_bucket_creation) {
        console.log(`Enabling bucket creation for ${email}`);
    } else {
        console.log(`Disabling bucket creation for ${email}`);
    }
    const s3_access = true;
    const allowed_buckets = get_allowed_buckets(s3_access);
    try {
        await client.account.update_account_s3_access({
            email,
            s3_access,
            allowed_buckets,
            default_pool: 'first-pool',
            allow_bucket_creation
        });
        await report.success('edit_bucket_creation');
    } catch (err) {
        report.fail('edit_bucket_creation');
        console.error('Editing access Failed with error: ', err);
        throw err;
    }
}

async function check_bucket_creation_permissions(email) {
    let create_bucket_status = await get_account_create_bucket_status(email);
    if (!create_bucket_status) {
        throw new Error(`Account ${email} default bucket creation permissions should be enabled`);
    }
    await edit_bucket_creation(email, false);
    create_bucket_status = await get_account_create_bucket_status(email);
    if (create_bucket_status) {
        throw new Error(`Account ${email} did not changed to disabled`);
    } else {
        try {
            const s3ops = new S3OPS({ ip: TEST_CFG.s3_ip, port: TEST_CFG.s3_port });
            await s3ops.create_bucket('shouldFail');
            throw new Error(`Create bucket should have failed`);
        } catch (e) {
            console.log(`Creating bucket failed, as should`);
        }
    }
    await edit_bucket_creation(email, true);
}

async function restrict_ip_access(email, ips) {
    console.log('Restrictions ip for account s3 access: ' + email);
    try {
        await client.account.update_account({
            email,
            ips
        });
        await report.success('restrict_ip_access');
    } catch (err) {
        report.fail('restrict_ip_access');
        console.error('Editing restriction ip access with error: ', err);
        throw err;
    }
}

async function verify_s3_access(email, bucket) {
    const keys = await get_s3_account_access(email);
    const s3ops = new S3OPS({
        ip: TEST_CFG.s3_ip,
        port: TEST_CFG.s3_port,
        access_key: keys.accessKeyId,
        secret_key: keys.secretAccessKey
    });
    const buckets = await s3ops.get_list_buckets();
    if (buckets.includes(bucket)) {
        console.log(`Created account has access to s3 bucket ${bucket}`);
    } else {
        saveErrorAndResume(`Created account doesn't have access to s3 bucket ${bucket}`);
        failures_in_test = true;
    }
}

async function verify_s3_no_access(email) {
    try {
        const keys = await get_s3_account_access(email);
        const s3ops = new S3OPS({
            ip: TEST_CFG.s3_ip,
            port: TEST_CFG.s3_port,
            access_key: keys.accessKeyId,
            secret_key: keys.secretAccessKey
        });
        await s3ops.get_list_buckets();
    } catch (err) {
        if (err.code === 'AccessDenied') {
            console.log(`Account doesn't have access to buckets after switch off access, err ${err.code} - as should`);
        } else {
            saveErrorAndResume('After switch off access to buckets account has access to s3');
            failures_in_test = true;
        }
    }
}

async function login_user(email) {
    rpc = api.new_rpc_from_base_address(`wss://${TEST_CFG.mgmt_ip}:${TEST_CFG.mgmt_port_https}`, 'EXTERNAL');
    client = rpc.new_client({});
    let auth_params = {
        email,
        password: 'DeMo1',
        system: 'demo'
    };
    const auth_token = await client.create_auth_token(auth_params);
    if (auth_token.token !== null && auth_token.token !== '') {
        console.log(`Account ${email} has access to server`);
    } else {
        saveErrorAndResume(`Account can't auth`);
        failures_in_test = true;
    }
}

async function reset_password(email) {
    console.log(`Resetting password for account ${email}`);
    try {
        await login_user('demo@noobaa.com');
        await client.account.reset_password({
            email,
            must_change_password: false,
            password: "DeMo1",
            verification_password: "DeMo1"
        });
        await report.success('reset_password');
    } catch (err) {
        report.fail('reset_password');
        console.error(`Resetting password Failed with error: ${err}`);
        throw err;
    }
    await rpc.disconnect_all();
}

async function verify_account_in_system(email, isPresent) {
    const emails = await get_accounts_emails();
    if (emails.includes(email) === isPresent) {
        console.log(`System contains ${isPresent} account`);
    } else {
        saveErrorAndResume(`Created account doesn't contain on system`);
        failures_in_test = true;
    }
}

async function disable_s3_Access_and_check(email) {
    await edit_s3Access(email, false);
    await P.delay(10 * 1000);
    const keys = await get_s3_account_access(email);
    if (keys.access === false) {
        console.log('S3 access was changed successfully');
    } else {
        saveErrorAndResume(`S3 access wasn't changed to false after edit`);
        failures_in_test = true;
    }
    const s3ops = new S3OPS({
        ip: TEST_CFG.s3_ip,
        port: TEST_CFG.s3_port,
        access_key: keys.accessKeyId,
        secret_key: keys.secretAccessKey
    });
    const buckets = await s3ops.get_list_buckets();
    if (buckets.length === 0) {
        console.log(`Account doesn't have access to buckets after changing access - as should`);
    } else {
        saveErrorAndResume(`After switch off s3 access account still has access to ${buckets}`);
        failures_in_test = true;
    }
    await edit_s3Access(email, true);
}

async function checkAccountFeatures() {
    const fullName = `${TEST_CFG.name}` + (Math.floor(Date.now() / 1000));
    const newAccount = await create_account(true, fullName);
    console.log(`Created account is ${newAccount} with access s3 ${TEST_CFG.s3_access}`);
    await verify_account_in_system(newAccount, true);
    if (TEST_CFG.s3_access === true) {
        await verify_s3_access(newAccount, TEST_CFG.bucket);
        await regenerate_s3Access(newAccount);
        await verify_s3_access(newAccount, TEST_CFG.bucket);
        await restrict_ip_access(newAccount, []);
        await verify_s3_no_access(newAccount);
        await restrict_ip_access(newAccount, null);
        await verify_s3_access(newAccount, TEST_CFG.bucket);
        await check_bucket_creation_permissions(newAccount);
        await disable_s3_Access_and_check(newAccount);
        await rpc.disconnect_all();
    } else {
        const keys = await get_s3_account_access(newAccount);
        if (keys.access === false) {
            console.log('S3 access was changed successfully');
        } else {
            saveErrorAndResume(`S3 access wasn't changed to false after edit`);
            failures_in_test = true;
        }
    }
    await reset_password(newAccount);
    await login_user(newAccount);
    await P.delay(10 * 1000);
    if (TEST_CFG.skip_delete) {
        console.log('Deleting skipped');
    } else {
        await login_user('demo@noobaa.com');
        await delete_account(newAccount);
        await P.delay(10 * 1000);
        await verify_account_in_system(newAccount, false);
    }
}

async function create_delete_accounts(cycle_num, count) {
    for (let account_num = 1; account_num <= count; account_num++) {
        console.log(`${YELLOW}Creating account number: ${account_num} in cycle ${cycle_num}${NC}`);
        const fullName = `${TEST_CFG.name}${account_num}_cycle${cycle_num}_` + (Math.floor(Date.now() / 1000));
        let newAccount;
        if (TEST_CFG.skip_create) {
            newAccount = fullName;
        } else {
            newAccount = await create_account(true, fullName);
        }
        console.log(`Created account is ${newAccount} with access s3 ${TEST_CFG.s3_access}`);
        await verify_account_in_system(newAccount, true);
        await P.delay(10 * 1000);
        if (TEST_CFG.skip_delete) {
            if (account_num === 1) {
                console.log('Deleting skipped');
            }
        } else {
            await delete_account(newAccount);
            await P.delay(10 * 1000);
            await verify_account_in_system(newAccount, false);
        }
    }
}

async function main() {
    if (TEST_CFG.skip_report) {
        report.pause();
    }
    console.log(`${YELLOW}Running test with ${
        TEST_CFG.cycles} cycles and ${
        TEST_CFG.accounts_number} accounts${NC}`);
    for (let cycle = 1; cycle <= TEST_CFG.cycles; cycle++) {
        console.log(`${YELLOW}Starting cycle ${cycle}${NC}`);
        try {
            await login_user('demo@noobaa.com');
            await checkAccountFeatures();
            await rpc.disconnect_all();
            await login_user('demo@noobaa.com');
            await create_delete_accounts(cycle, TEST_CFG.accounts_number);
            await P.delay(10 * 1000);
        } catch (err) {
            console.error('something went wrong ' + err + errors);
            failures_in_test = true;
        }
    }
    await rpc.disconnect_all();
    await report.report();
    if (failures_in_test) {
        console.error('Errors during account test ' + errors);
        process.exit(1);
    } else {
        console.log('account test were successful');
        process.exit(0);
    }
}

main();
