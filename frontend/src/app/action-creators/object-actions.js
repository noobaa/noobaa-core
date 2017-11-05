import {
    FETCH_BUCKET_OBJECTS,
    COMPLETE_FETCH_BUCKET_OBJECTS,
    FAIL_FETCH_BUCKET_OBJECTS,
    DELETE_BUCKET_OBJECT,
    COMPLETE_DELETE_BUCKET_OBJECT,
    FAIL_DELETE_BUCKET_OBJECT
} from 'action-types';

export function fetchBucketObjects(query) {
    const timestamp = Date.now();

    return {
        type: FETCH_BUCKET_OBJECTS,
        payload: { query, timestamp }
    };
}

export function completeFetchBucketObjects(query, response) {
    return {
        type: COMPLETE_FETCH_BUCKET_OBJECTS,
        payload: { query , response }
    };
}

export function failFetchBucketObjects(query, error) {
    return {
        type: FAIL_FETCH_BUCKET_OBJECTS,
        payload: { query, error }
    };
}

export function deleteBucketObject(bucket, key, uploadId, accessData){
    return {
        type: DELETE_BUCKET_OBJECT,
        payload: { bucket, key, uploadId, accessData }
    };
}

export function completeDeleteBucketObject(bucket, key, uploadId) {
    return {
        type: COMPLETE_DELETE_BUCKET_OBJECT,
        payload: { bucket, key, uploadId }
    };
}

export function failDeleteBucketObject(bucket, key, uploadId, error) {
    return {
        type: FAIL_DELETE_BUCKET_OBJECT,
        payload: { bucket, key, uploadId, error }

    };
}
