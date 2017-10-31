/* Copyright (C) 2016 NooBaa */

import {
    CREATE_HOSTS_POOL,
    COMPLETE_CREATE_HOSTS_POOL,
    FAIL_CREATE_HOSTS_POOL,
    DELETE_RESOURCE,
    COMPLETE_DELETE_RESOURCE,
    FAIL_DELETE_RESOURCE,
    ASSIGN_HOSTS_TO_POOL,
    COMPLETE_ASSIGN_HOSTS_TO_POOL,
    FAIL_ASSIGN_HOSTS_TO_POOL
} from 'action-types';

export function createHostsPool(name, hosts) {
    return {
        type: CREATE_HOSTS_POOL,
        payload: { name, hosts }
    };
}

export function completeCreateHostsPool(name) {
    return {
        type: COMPLETE_CREATE_HOSTS_POOL,
        payload: { name }
    };
}

export function failCreateHostsPool(name, error) {
    return {
        type: FAIL_CREATE_HOSTS_POOL,
        payload: { name, error }
    };
}

export function deleteResource(resource) {
    return {
        type: DELETE_RESOURCE,
        payload: { resource }
    };
}

export function completeDeleteResource(resource) {
    return {
        type: COMPLETE_DELETE_RESOURCE,
        payload: { resource }
    };
}

export function failDeleteResource(resource, error) {
    return {
        type: FAIL_DELETE_RESOURCE,
        payload: { resource, error }
    };
}

export function assignHostsToPool(pool, hosts) {
    return {
        type: ASSIGN_HOSTS_TO_POOL,
        payload: { pool, hosts }
    };
}

export function completeAssignHostsToPool(pool, hosts) {
    return {
        type: COMPLETE_ASSIGN_HOSTS_TO_POOL,
        payload: { pool, hosts }
    };
}

export function failAssignHostsToPool(pool, error) {
    return {
        type: FAIL_ASSIGN_HOSTS_TO_POOL,
        payload: { pool, error }
    };
}
