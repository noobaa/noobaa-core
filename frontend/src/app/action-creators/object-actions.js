import {
    FETCH_OBJECTS,
    COMPLETE_FETCH_OBJECTS,
    FAIL_FETCH_OBJECTS,
    DELETE_OBJECT,
    COMPLETE_DELETE_OBJECT,
    DROP_OBJECTS_VIEW,
    FAIL_DELETE_OBJECT,
    FETCH_OBJECT_PARTS,
    COMPLETE_FETCH_OBJECT_PARTS,
    FAIL_FETCH_OBJECT_PARTS
} from 'action-types';

export function fetchObjects(view, query, s3Endpoint) {
    const timestamp = Date.now();

    return {
        type: FETCH_OBJECTS,
        payload: { view, query, timestamp, s3Endpoint }
    };
}

export function completeFetchObjects(query, response) {
    return {
        type: COMPLETE_FETCH_OBJECTS,
        payload: { query , response }
    };
}

export function failFetchObjects(query, error) {
    return {
        type: FAIL_FETCH_OBJECTS,
        payload: { query, error }
    };
}

export function deleteObject(bucket, key, uploadId, accessData){
    return {
        type: DELETE_OBJECT,
        payload: { bucket, key, uploadId, accessData }
    };
}

export function completeDeleteObject(bucket, key, uploadId) {
    return {
        type: COMPLETE_DELETE_OBJECT,
        payload: { bucket, key, uploadId }
    };
}

export function failDeleteObject(bucket, key, uploadId, error) {
    return {
        type: FAIL_DELETE_OBJECT,
        payload: { bucket, key, uploadId, error }

    };
}

export function dropObjectsView(view) {
    return {
        type: DROP_OBJECTS_VIEW,
        payload: { view }
    };
}

export function fetchObjectParts(query) {
    return {
        type: FETCH_OBJECT_PARTS,
        payload: query
    };
}

export function completeFetchObjectParts(query, parts) {
    return {
        type: COMPLETE_FETCH_OBJECT_PARTS,
        payload: { query, parts }
    };
}

export function failFetchObjectParts(query, error) {
    return {
        type: FAIL_FETCH_OBJECT_PARTS,
        payload: { query, error }
    };
}
