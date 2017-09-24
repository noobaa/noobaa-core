import {
    UPDATE_BUCKET_QUOTA,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA,
    CREATE_GATEWAY_BUCKET,
    COMPLETE_CREATE_GATEWAY_BUCKET,
    FAIL_CREATE_GATEWAY_BUCKET,
    UPDATE_GATEWAY_BUCKET_PLACEMENT,
    COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT,
    FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT,
    DELETE_GATEWAY_BUCKET,
    COMPLETE_DELETE_GATEWAY_BUCKET,
    FAIL_DELETE_GATEWAY_BUCKET,
} from 'action-types';

export function updateBucketQuota(bucket, quota) {
    return {
        type: UPDATE_BUCKET_QUOTA,
        payload: { bucket, quota }
    };
}

export function completeUpdateBucketQuota(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_QUOTA,
        payload: { bucket }
    };
}

export function failUpdateBucketQuota(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_QUOTA,
        payload: { bucket, error }
    };
}

export function createGatewayBucket(name, readFrom, writeTo) {
    return {
        type: CREATE_GATEWAY_BUCKET,
        payload: { name, readFrom, writeTo }
    };
}

export function completeCreateGatewayBucket(name) {
    return {
        type: COMPLETE_CREATE_GATEWAY_BUCKET,
        payload: { name }
    };
}

export function failCreateGatewayBucket(name, error) {
    return {
        type: FAIL_CREATE_GATEWAY_BUCKET,
        payload: { name, error }
    };
}

export function updateGatewayBucketPlacement(name, readFrom, writeTo) {
    return {
        type: UPDATE_GATEWAY_BUCKET_PLACEMENT,
        payload: { name, readFrom, writeTo }
    };
}

export function completeUpdateGatewayBucketPlacement(name) {
    return {
        type: COMPLETE_UPDATE_GATEWAY_BUCKET_PLACEMENT,
        payload: { name }
    };
}

export function failGatewayBucketPlacement(name, error) {
    return {
        type: FAIL_UPDATE_GATEWAY_BUCKET_PLACEMENT,
        payload: { name, error }
    };
}

export function deleteGatewayBucket(name) {
    return {
        type: DELETE_GATEWAY_BUCKET,
        payload: { name }
    };
}

export function completeDeleteGatewayBucket(name) {
    return {
        type: COMPLETE_DELETE_GATEWAY_BUCKET,
        payload: { name }
    };
}

export function failCompleteDeleteGatewayBucket(name, error) {
    return {
        type: FAIL_DELETE_GATEWAY_BUCKET,
        payload: { name, error }
    };
}
