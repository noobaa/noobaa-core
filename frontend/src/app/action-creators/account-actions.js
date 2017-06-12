/* Copyright (C) 2016 NooBaa */

import {
    CREATE_ACCOUNT,
    COMPLETE_CREATE_ACCOUNT,
    FAIL_CREATE_ACCOUNT,
    UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS
} from 'action-types';

export function createAccount(
    accountName,
    hasLoginAccess,
    password,
    hasS3Access,
    defaultResource,
    hasAccessToAllBucekts,
    allowedBuckets
) {
    return {
        type: CREATE_ACCOUNT,
        payload: {
            accountName,
            hasLoginAccess,
            password,
            hasS3Access,
            defaultResource,
            hasAccessToAllBucekts,
            allowedBuckets
        }
    };
}

export function completeCreateAccount(accountName, password) {
    return {
        type: COMPLETE_CREATE_ACCOUNT,
        payload: { accountName, password }
    };
}

export function failCreateAccount(accountName, error) {
    return {
        type: FAIL_CREATE_ACCOUNT,
        payload: { accountName, error }
    };
}

export function updateAccountS3Access(
    accountName,
    hasS3Access,
    defaultResource,
    hasAccessToAllBuckets,
    allowedBuckets
) {
    return {
        type: UPDATE_ACCOUNT_S3_ACCESS,
        payload: {
            accountName,
            hasS3Access,
            defaultResource,
            hasAccessToAllBuckets,
            allowedBuckets
        }
    };
}

export function completeUpdateAccountS3Access(accountName) {
    return {
        type: COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
        payload: { accountName }
    };
}

export function failUpdateAccountS3Access(accountName, error) {
    return {
        type: FAIL_UPDATE_ACCOUNT_S3_ACCESS,
        payload: { accountName, error }
    };
}

export function setAccountIpRestrictions(accountName, allowedIps) {
    return {
        type: SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName, allowedIps }
    };
}

export function completeSetAccountIpRestrictions(accountName) {
    return {
        type: COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName }

    };
}

export function failSetAccountIpRestrictions(accountName, error) {
    return {
        type: FAIL_SET_ACCOUNT_IP_RESTRICTIONS,
        payload: { accountName, error }
    };
}
