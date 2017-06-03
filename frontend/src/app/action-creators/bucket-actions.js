import {
    UPDATE_BUCKET_QUOTA,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA,
    UPDATE_BUCKET_SPILLOVER,
    COMPLETE_UPDATE_BUCKET_SPILLOVER,
    FAIL_UPDATE_BUCKET_SPILLOVER
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

export function updateBucketSpillover(bucket, spilloverEnabled) {
    return {
        type: UPDATE_BUCKET_SPILLOVER,
        payload: { bucket, spilloverEnabled }
    };
}

export function completeUpdateBucketSpillover(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_SPILLOVER,
        payload: { bucket }
    };
}

export function failUpdateBucketSpillover(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_SPILLOVER,
        payload: { bucket, error }
    };
}
