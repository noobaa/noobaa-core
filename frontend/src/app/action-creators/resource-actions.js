/* Copyright (C) 2016 NooBaa */

import {
    DELETE_RESOURCE,
    COMPLETE_DELETE_RESOURCE,
    FAIL_DELETE_RESOURCE
} from 'action-types';

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
