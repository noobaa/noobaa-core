import {
    FETCH_BUCKET_OBJECTS,
    COMPLETE_FETCH_BUCKET_OBJECTS,
    FAIL_FETCH_BUCKET_OBJECTS,
    DELETE_BUCKET_OBJECT,
    COMPLETE_DELETE_BUCKET_OBJECT,
    FAIL_DELETE_BUCKET_OBJECT,
    ABORT_OBJECT_UPLOAD,
    COMPLETE_ABORT_OBJECT_UPLOAD,
    FAIL_ABORT_OBJECT_UPLOAD
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

export function abortObjectUpload(bucket, object, objId, accessKey, secretKey){
    return {
        type: ABORT_OBJECT_UPLOAD,
        payload: { bucket, object, objId, accessKey, secretKey }
    };
}

export function completeAbortObjectUpload(bucket, object, objId) {
    return {
        type: COMPLETE_ABORT_OBJECT_UPLOAD,
        payload: { bucket, object, objId }
    };
}

export function failAbortObjectUpload(bucket, object, objId, error) {
    return {
        type: FAIL_ABORT_OBJECT_UPLOAD,
        payload: { bucket, object, objId, error }

    };
}