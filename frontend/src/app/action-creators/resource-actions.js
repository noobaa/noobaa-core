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
    FAIL_ASSIGN_HOSTS_TO_POOL,
    ASSIGN_REGION_TO_RESOURCE,
    COMPLETE_ASSIGN_REGION_TO_RESOURCE,
    FAIL_ASSIGN_REGION_TO_RESOURCE,
    FETCH_CLOUD_RESOURCE_OBJECTS,
    COMPLETE_FETCH_CLOUD_RESOURCE_OBJECTS,
    FAIL_FETCH_CLOUD_RESOURCE_OBJECTS
} from 'action-types';


export function createHostsPool(poolName, nodeCount, nodeVolumeSize, isManaged) {
    return {
        type: CREATE_HOSTS_POOL,
        payload: { poolName, nodeCount, nodeVolumeSize, isManaged }
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

export function assignRegionToResource(resourceType, resourceName, region) {
    return {
        type: ASSIGN_REGION_TO_RESOURCE,
        payload: { resourceType, resourceName, region }
    };
}

export function completeAssignRegionToResource(resourceType, resourceName, region) {
    return {
        type: COMPLETE_ASSIGN_REGION_TO_RESOURCE,
        payload: { resourceType, resourceName, region }
    };
}

export function failAssignRegionToResource(resourceType, resourceName, region, error) {
    return {
        type: FAIL_ASSIGN_REGION_TO_RESOURCE,
        payload: { resourceType, resourceName, region, error }
    };
}

export function fetchCloudResourceObjects(resource, skip, limit) {
    return {
        type: FETCH_CLOUD_RESOURCE_OBJECTS,
        payload: { resource, skip, limit }
    };
}

export function completeFetchCloudResourceObjects(resource, skip, limit, response) {
    return {
        type: COMPLETE_FETCH_CLOUD_RESOURCE_OBJECTS,
        payload: {
            query: { resource, skip, limit },
            response
        }
    };
}

export function failFetchCloudResourceObjects(resource, skip, limit, error) {
    return {
        type: FAIL_FETCH_CLOUD_RESOURCE_OBJECTS,
        payload: {
            query: { resource, skip, limit },
            error
        }
    };
}
