/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import { COMPLETE_FETCH_SYSTEM_INFO, START_CREATE_ACCOUNT, FAIL_CREATE_ACCOUNT } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onCompleteFetchSystemInfo(_, { info }) {
    return keyByProperty(info.accounts, 'email', account => {
        const accessKeys = account.access_keys[0];
        return {
            name: account.name,
            email: account.email,
            hasS3Access: account.has_s3_access,
            allowedBuckets: account.allowed_buckets,
            defaultResource: account.default_pool,
            accessKeys: {
                accessKey: accessKeys.access_key,
                secretKey: accessKeys.secret_key
            }
        };
    });
}

function onStartCreateAccount(accounts, { name, email }) {
    return {
        ...accounts,
        [email]: { name, email, mode: 'IN_CREATION' }
    };
}

function onFailCreateAccount(accounts, { email }) {
    return {
        ...accounts,
        [email]: {
            ...accounts.email,
            mode: 'CREATION_FAILURE'
        }
    };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [START_CREATE_ACCOUNT]: onStartCreateAccount,
    [FAIL_CREATE_ACCOUNT]: onFailCreateAccount
});
