import {
    CREATE_NAMESPACE_RESOURCE,
    COMPLETE_CREATE_NAMESPACE_RESOURCE,
    FAIL_CREATE_NAMESPACE_RESOURCE,
    DELETE_NAMESPACE_RESOURCE,
    COMPLETE_DELETE_NAMESPACE_RESOURCE,
    FAIL_DELETE_NAMESPACE_RESOURCE
} from 'action-types';

export function createNamespaceResource(name, connection, target) {
    return {
        type: CREATE_NAMESPACE_RESOURCE,
        payload: { name, connection, target }
    };
}

export function completeCreateNamespaceResource(name) {
    return {
        type: COMPLETE_CREATE_NAMESPACE_RESOURCE,
        payload: { name }
    };
}

export function failCreateNamespaceResource(name, error) {
    return {
        type: FAIL_CREATE_NAMESPACE_RESOURCE,
        payload: { name, error }
    };
}


export function deleteNamespaceResource(name) {
    return {
        type: DELETE_NAMESPACE_RESOURCE,
        payload: { name }
    };
}

export function completeDeleteNamespaceResource(name) {
    return {
        type: COMPLETE_DELETE_NAMESPACE_RESOURCE,
        payload: { name }
    };
}

export function failDeleteNamespaceResource(name, error) {
    return {
        type: FAIL_DELETE_NAMESPACE_RESOURCE,
        payload: { name, error }
    };
}

