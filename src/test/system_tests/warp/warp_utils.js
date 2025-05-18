/* Copyright (C) 2016 NooBaa */
"use strict";

const api = require('../../../api');
const { WARP_TEST } = require('./warp_constants');
const SensitiveString = require('../../../util/sensitive_string');
const { get_account, create_account, create_bucket } = require('../nc_test_utils');

/**
 * get_global_rpc_client returns a global RPC client.
 * @returns {nb.APIClient}
 */
function get_global_rpc_client() {
    const rpc = api.new_rpc();
    const global_rpc_client = rpc.new_client({
        address: `${process.env.NOOBAA_MGMT_SERVICE_PROTO || 'ws'}://${process.env.NOOBAA_MGMT_SERVICE_HOST}:${process.env.NOOBAA_MGMT_SERVICE_PORT}`
    });
    return global_rpc_client;
}

/**
 * get_authenticated_global_rpc_client returns an authenticated global RPC client.
 * @returns {Promise<nb.APIClient>}
 */
async function get_authenticated_global_rpc_client() {
    const global_rpc_client = await get_rpc_client_by_email_and_password(process.env.email, process.env.password);
    return global_rpc_client;
}

/**
 * get_rpc_client_by_email_and_password returns an RPC client authenticated by email and password.
 * @param {String} email 
 * @param {String} password 
 * @returns {Promise<nb.APIClient>}
 */
async function get_rpc_client_by_email_and_password(email, password) {
    const rpc_client = get_global_rpc_client();
    const auth_params = { email, password, system: 'noobaa' };
    await rpc_client.create_auth_token(auth_params);
    return rpc_client;
}

/**
 * get_account_by_name returns the account object by name.
 * @param {String} account_name 
 * @returns {Promise<Object>}
 */
async function get_account_by_name(account_name) {
    const global_rpc_client = await get_authenticated_global_rpc_client();
    const system = await global_rpc_client.system.read_system();
    const warp_account = system.accounts.find(account =>
        account.name.unwrap() === account_name
    );
    return warp_account;
}

/**
 * get_warp_access_keys returns the access keys of the warp account.
 * @param {String} account_name
 * @returns {Promise<{ access_key: String, secret_key: String }>}
 */
async function get_warp_access_keys(account_name) {
    const warp_account = process.env.LOCAL_MD_SERVER === 'true' ?
        await get_account_by_name(account_name) :
        await get_account(account_name);
    const warp_access_keys = warp_account.access_keys[0];
    const access_key = new SensitiveString(warp_access_keys.access_key).unwrap();
    const secret_key = new SensitiveString(warp_access_keys.secret_key).unwrap();
    return { access_key, secret_key };
}

/**
 * create_warp_account creates a warp account.
 * @returns {Promise<void>}
 */
async function create_warp_account() {
    try {
        if (is_containerized_deployment()) {
            await create_containerized_account();
        } else {
            const account_options = WARP_TEST.nc_warp_account_params;
            await create_account(account_options);
        }
        console.info('WARP account created:', WARP_TEST.warp_account_params);
    } catch (err) {
        throw new Error(`Failed to create account ${err.message}`);
    }
}

/**
 * create_warp_bucket creates a bucket in warp.
 * @returns {Promise<void>}
 */
async function create_warp_bucket() {
    try {
        if (is_containerized_deployment()) {
            await create_containerized_bucket();
        } else {
            const bucket_options = WARP_TEST.nc_warp_bucket_params;
            await create_bucket(bucket_options);
        }
    } catch (err) {
        throw new Error(`Failed to create bucket ${err.message}`);
    }
}

/**
 * create_containerized_account creates a containerized account.
 * @returns {Promise<void>}
 */
async function create_containerized_account() {
    const global_rpc_client = await get_authenticated_global_rpc_client();
    const system = await global_rpc_client.system.read_system();
    // We are taking the first host pool, in normal k8s setup is default backing store 
    const test_pool = system.pools.filter(p => p.resource_type === 'HOSTS')[0];
    console.log(test_pool);
    await global_rpc_client.account.create_account({
        ...WARP_TEST.warp_account_params,
        default_resource: test_pool.name
    });
}

/**
 * create_containerized_bucket creates a bucket in containerized deployment.
 * @returns {Promise<void>}
 */
async function create_containerized_bucket() {
    const { email, password } = WARP_TEST.warp_account_params;
    const warp_account_rpc_client = await get_rpc_client_by_email_and_password(email, password);
    await warp_account_rpc_client.bucket.create_bucket({
        name: WARP_TEST.warp_bucket_params.name,
    });
    console.info('WARP bucket created:', WARP_TEST.warp_bucket_params);
}

/**
 * is_containerized_deployment checks if the deployment is containerized or not.
 * @returns {boolean}
 */
function is_containerized_deployment() {
    return process.env.LOCAL_MD_SERVER === 'true';
}

// EXPORTS
exports.create_warp_bucket = create_warp_bucket;
exports.create_warp_account = create_warp_account;
exports.get_warp_access_keys = get_warp_access_keys;
exports.get_authenticated_global_rpc_client = get_authenticated_global_rpc_client;
exports.get_rpc_client_by_email_and_password = get_rpc_client_by_email_and_password;

