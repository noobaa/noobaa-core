import {
    FETCH_BUCKET_OBJECTS,
    COMPLETE_FETCH_BUCKET_OBJECTS,
    FAIL_FETCH_BUCKET_OBJECTS,
    DELETE_BUCKET_OBJECT,
    COMPLETE_DELETE_BUCKET_OBJECT,
    FAIL_DELETE_BUCKET_OBJECT
} from 'action-types';

export function fetchBucketObjects(bucketName, filter, sortBy, order, page, uploadMode) {
    return {
        type: FETCH_BUCKET_OBJECTS,
        payload: { bucketName, filter, sortBy, order, page, uploadMode }
    };
}

export function completeFetchBucketObjects(bucketName, filter, sortBy, order, page, uploadMode, response) {
    return {
        type: COMPLETE_FETCH_BUCKET_OBJECTS,
        payload: {
            query: { bucketName, filter, sortBy, order, page, uploadMode },
            response
        }
    };
}

export function failFetchBucketObjects(bucketName, filter, sortBy, order, page, uploadMode, error) {
    return {
        type: FAIL_FETCH_BUCKET_OBJECTS,
        payload: {
            query: { bucketName, filter, sortBy, order, page, uploadMode },
            error
        }
    };
}

export function deleteBucketObject(bucket, object, accessKey, secretKey){
    return {
        type: DELETE_BUCKET_OBJECT,
        payload: { bucket, object, accessKey, secretKey }
    };
}

export function completeDeleteBucketObject(bucket, object) {
    return {
        type: COMPLETE_DELETE_BUCKET_OBJECT,
        payload: { bucket, object }
    };
}

export function failDeleteBucketObject(bucket, object, error) {
    return {
        type: FAIL_DELETE_BUCKET_OBJECT,
        payload: { bucket, object, error }

    };
}