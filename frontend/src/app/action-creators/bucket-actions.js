import {
    UPDATE_BUCKET_QUOTA,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA
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
