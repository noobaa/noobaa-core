/* Copyright (C) 2016 NooBaa */
'use strict';

const test_utils = require('../system_tests/test_utils');
const { TYPES, ACTIONS } = require('../../manage_nsfs/manage_nsfs_constants');

/**
 * get_access_keys returns account access keys using noobaa-cli
 * @param {string} account_name 
 */
async function get_access_keys(account_name) {
    const account_data = await get_account(account_name);
    return account_data.access_keys[0];
}

/**
 * get_account returns account data using noobaa-cli
 * @param {string} account_name 
 */
async function get_account(account_name) {
    const options = { name: account_name, show_secrets: true };
    const res = await test_utils.exec_manage_cli(TYPES.ACCOUNT, ACTIONS.STATUS, options);
    const json_account = JSON.parse(res);
    const account_data = json_account.response.reply;
    return account_data;
}

/**
 * create_account creates account using noobaa-cli
 * @param {{ name?: string, uid?: number, gid?: number, anonymous?: boolean }} [options] 
 */
async function create_account(options = {}) {
    const res = await test_utils.exec_manage_cli(TYPES.ACCOUNT, ACTIONS.ADD, options);
    console.log('NC Account Created', res);
}

/**
 * create_bucket creates bucket using noobaa-cli
 * @param {{ name?: string, owner?: string, path?: string}} [options] 
 */
async function create_bucket(options = {}) {
    const res = await test_utils.exec_manage_cli(TYPES.BUCKET, ACTIONS.ADD, options);
    console.log('NC Bucket Created', res);
}

// EXPORTS
exports.get_account = get_account;
exports.get_access_keys = get_access_keys;
exports.create_account = create_account;
exports.create_bucket = create_bucket;
