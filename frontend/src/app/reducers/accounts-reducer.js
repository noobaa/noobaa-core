/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { keyByProperty } from 'utils/core-utils';
import {
    COMPLETE_FETCH_SYSTEM_INFO
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = undefined;

// ------------------------------
// Action Handlers
// ------------------------------
function onCompleteFetchSystemInfo(_, { payload }) {
    const { buckets, accounts, owner } = payload;
    const allBuckets = buckets.map(bucket => bucket.name);

    return keyByProperty(accounts, 'email', account => {
        const {
            email,
            has_login,
            access_keys,
            has_s3_access,
            default_pool,
            allowed_buckets,
            allowed_ips,
            external_connections
        } = account;

        const {
            access_key: accessKey,
            secret_key: secretKey
        } = access_keys[0];

        const hasAccessToAllBuckets = has_s3_access && allowed_buckets.full_permission;
        const allowedBuckets = has_s3_access ?
             (hasAccessToAllBuckets ? allBuckets : allowed_buckets.permission_list) :
             [];

        const externalConnections = _mapExternalConnections(external_connections);

        return {
            name: email,
            isOwner: email === owner.email,
            hasLoginAccess: has_login,
            hasS3Access: has_s3_access,
            hasAccessToAllBuckets,
            allowedBuckets,
            defaultResource: default_pool,
            accessKeys: { accessKey, secretKey },
            allowedIps: allowed_ips,
            externalConnections
        };
    });
}

// ------------------------------
// Local util functions
// ------------------------------
function _mapExternalConnections(externalConnections) {
    return externalConnections
        .connections.map(conn => ({
            name: conn.name,
            service: conn.endpoint_type,
            endpoint: conn.endpoint,
            identity: conn.identity,
            usage: conn.usage.map(record => ({
                entity: record.entity,
                externalEntity: record.external_entity,
                usageType: record.usage_type
            }))
        }));
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
