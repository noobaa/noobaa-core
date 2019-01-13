import {
    FETCH_OBJECTS,
    COMPLETE_FETCH_OBJECTS,
    FAIL_FETCH_OBJECTS,
    FETCH_OBJECT,
    COMPLETE_FETCH_OBJECT,
    FAIL_FETCH_OBJECT,
    DELETE_OBJECT,
    COMPLETE_DELETE_OBJECT,
    DROP_OBJECTS_VIEW,
    FAIL_DELETE_OBJECT,
    FETCH_OBJECT_PARTS,
    COMPLETE_FETCH_OBJECT_PARTS,
    FAIL_FETCH_OBJECT_PARTS
} from 'action-types';

export function fetchObjects(view, query, s3Endpoint) {
    return {
        type: FETCH_OBJECTS,
        payload: { view, query, s3Endpoint }
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

export function fetchObject(view, bucket, object, version, s3Endpoint) {
    return {
        type: FETCH_OBJECT,
        payload: { view, bucket, object, version, s3Endpoint }
    };
}

export function completeFetchObject(bucket, object, version, response) {
    return {
        type: COMPLETE_FETCH_OBJECT,
        payload: { bucket, object, version, response }
    };
}

export function failFetchObject(bucket, object, version, error) {
    return {
        type: FAIL_FETCH_OBJECT,
        payload: { bucket, object, version, error }
    };

}

export function deleteObject(objId, accessData) {
    return {
        type: DELETE_OBJECT,
        payload: { objId, accessData }
    };
}

export function completeDeleteObject(objId) {
    return {
        type: COMPLETE_DELETE_OBJECT,
        payload: { objId }
    };
}

export function failDeleteObject(objId, error) {
    return {
        type: FAIL_DELETE_OBJECT,
        payload: { objId, error }

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

export function completeFetchObjectParts(query, chunks) {
    return {
        type: COMPLETE_FETCH_OBJECT_PARTS,
        payload: { query, chunks }
    };
}

export function failFetchObjectParts(query, error) {
    return {
        type: FAIL_FETCH_OBJECT_PARTS,
        payload: { query, error }
    };
}
