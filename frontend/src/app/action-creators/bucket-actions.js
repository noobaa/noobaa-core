import {
    UPDATE_BUCKET_QUOTA,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA,
    TOGGLE_BUCKET_SPILLOVER,
    COMPLETE_TOGGLE_BUCKET_SPILLOVER,
    FAIL_TOGGLE_BUCKET_SPILLOVER,
    TOGGLE_BUCKETS_SPILLOVER,
    COMPLETE_TOGGLE_BUCKETS_SPILLOVER,
    FAIL_TOGGLE_BUCKETS_SPILLOVER,
    UPDATE_BUCKET_PLACEMENT_POLICY,
    COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY,
    FAIL_UPDATE_BUCKET_PLACEMENT_POLICY,
    UPDATE_BUCKET_RESILIENCY_POLICY,
    COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
    FAIL_UPDATE_BUCKET_RESILIENCY_POLICY,
    DELETE_BUCKET,
    COMPLETE_DELETE_BUCKET,
    FAIL_DELETE_BUCKET,
    CREATE_NAMESPACE_BUCKET,
    COMPLETE_CREATE_NAMESPACE_BUCKET,
    FAIL_CREATE_NAMESPACE_BUCKET,
    UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    FAIL_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
    DELETE_NAMESPACE_BUCKET,
    COMPLETE_DELETE_NAMESPACE_BUCKET,
    FAIL_DELETE_NAMESPACE_BUCKET,
    UPDATE_BUCKET_S3_ACCESS,
    COMPLETE_UPDATE_BUCKET_S3_ACCESS,
    FAIL_UPDATE_BUCKET_S3_ACCESS,
    DELETE_CLOUD_SYNC_POLICY,
    COMPLETE_DELETE_CLOUD_SYNC_POLICY,
    FAIL_DELETE_CLOUD_SYNC_POLICY,
    TOGGLE_CLOUD_SYNC_POLICY,
    COMPLETE_TOGGLE_CLOUD_SYNC_POLICY,
    FAIL_TOGGLE_CLOUD_SYNC_POLICY,
    ADD_BUCKET_TRIGGER,
    COMPLETE_ADD_BUCKET_TRIGGER,
    FAIL_ADD_BUCKET_TRIGGER,
    UPDATE_BUCKET_TRIGGER,
    COMPLETE_UPDATE_BUCKET_TRIGGER,
    FAIL_UPDATE_BUCKET_TRIGGER,
    REMOVE_BUCKET_TRIGGER,
    COMPLETE_REMOVE_BUCKET_TRIGGER,
    FAIL_REMOVE_BUCKET_TRIGGER
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

export function toggleBucketSpillover(bucket, state) {
    return {
        type: TOGGLE_BUCKET_SPILLOVER,
        payload: { bucket, state }
    };
}

export function completeToggleBucketSpillover(bucket, state) {
    return {
        type: COMPLETE_TOGGLE_BUCKET_SPILLOVER,
        payload: { bucket, state }
    };
}

export function failToggleBucketSpillover(bucket, state, error) {
    return {
        type: FAIL_TOGGLE_BUCKET_SPILLOVER,
        payload: { bucket, state, error }
    };
}

export function toggleBucketsSpillover(settings) {
    return {
        type: TOGGLE_BUCKETS_SPILLOVER,
        payload: settings
    };
}

export function completeToggleBucketsSpillover() {
    return { type: COMPLETE_TOGGLE_BUCKETS_SPILLOVER };
}

export function failToggleBucketsSpillover(error) {
    return {
        type: FAIL_TOGGLE_BUCKETS_SPILLOVER,
        payload: { error }
    };
}

export function updateBucketPlacementPolicy(bucket, tier, policyType, resources) {
    return {
        type: UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket, tier, policyType,resources }
    };
}

export function completeUpdateBucketPlacementPolicy(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket }
    };
}

export function failUpdateBucketPlacementPolicy(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_PLACEMENT_POLICY,
        payload: { bucket, error }
    };
}

export function updateBucketResiliencyPolicy(bucket, tier, policy) {
    return {
        type: UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket, tier, policy }
    };
}

export function completeUpdateBucketResiliencyPolicy(bucket) {
    return {
        type: COMPLETE_UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket }
    };
}

export function failUpdateBucketResiliencyPolicy(bucket, error) {
    return {
        type: FAIL_UPDATE_BUCKET_RESILIENCY_POLICY,
        payload: { bucket, error }
    };
}

export function deleteBucket(bucket){
    return {
        type: DELETE_BUCKET,
        payload: { bucket }
    };
}

export function completeDeleteBucket(bucket) {
    return {
        type: COMPLETE_DELETE_BUCKET,
        payload: { bucket }
    };
}

export function failDeleteBucket(bucket, error) {
    return {
        type: FAIL_DELETE_BUCKET,
        payload: { bucket, error }

    };
}

export function createNamespaceBucket(name, readFrom, writeTo) {
    return {
        type: CREATE_NAMESPACE_BUCKET,
        payload: { name, readFrom, writeTo }
    };
}

export function completeCreateNamespaceBucket(name) {
    return {
        type: COMPLETE_CREATE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function failCreateNamespaceBucket(name, error) {
    return {
        type: FAIL_CREATE_NAMESPACE_BUCKET,
        payload: { name, error }
    };
}

export function updateNamespaceBucketPlacement(name, readFrom, writeTo) {
    return {
        type: UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name, readFrom, writeTo }
    };
}

export function completeUpdateNamespaceBucketPlacement(name) {
    return {
        type: COMPLETE_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name }
    };
}

export function failNamespaceBucketPlacement(name, error) {
    return {
        type: FAIL_UPDATE_NAMESPACE_BUCKET_PLACEMENT,
        payload: { name, error }
    };
}

export function deleteNamespaceBucket(name) {
    return {
        type: DELETE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function completeDeleteNamespaceBucket(name) {
    return {
        type: COMPLETE_DELETE_NAMESPACE_BUCKET,
        payload: { name }
    };
}

export function failCompleteDeleteNamespaceBucket(name, error) {
    return {
        type: FAIL_DELETE_NAMESPACE_BUCKET,
        payload: { name, error }
    };
}

export function updateBucketS3Access(bucketName, allowedAccounts) {
    return {
        type: UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName, allowedAccounts }
    };
}

export function completeUpdateBucketS3Access(bucketName) {
    return {
        type: COMPLETE_UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName }
    };
}

export function failUpdateBucketS3Access(bucketName, error) {
    return {
        type: FAIL_UPDATE_BUCKET_S3_ACCESS,
        payload: { bucketName, error }
    };
}

export function deleteCloudSyncPolicy(bucketName) {
    return {
        type: DELETE_CLOUD_SYNC_POLICY,
        payload: { bucketName }
    };
}

export function completeDeleteCloudSyncPolicy(bucketName) {
    return {
        type: COMPLETE_DELETE_CLOUD_SYNC_POLICY,
        payload: { bucketName }
    };
}

export function failDeleteCloudSyncPolicy(bucketName, error) {
    return {
        type: FAIL_DELETE_CLOUD_SYNC_POLICY,
        payload: { bucketName, error }
    };
}

export function toggleCloudSyncPolicy(bucketName, paused) {
    return {
        type: TOGGLE_CLOUD_SYNC_POLICY,
        payload: { bucketName, paused }
    };
}

export function completeToggleCloudSyncPolicy(bucketName, paused) {
    return {
        type: COMPLETE_TOGGLE_CLOUD_SYNC_POLICY,
        payload: { bucketName, paused }
    };
}

export function failToggleCloudSyncPolicy(bucketName, paused, error) {
    return {
        type: FAIL_TOGGLE_CLOUD_SYNC_POLICY,
        payload: { bucketName, paused, error }
    };
}

export function addBucketTrigger(bucketName, config) {

    return {
        type: ADD_BUCKET_TRIGGER,
        payload: { bucketName, config }
    };
}

export function completeAddBucketTrigger(bucketName) {
    return {
        type: COMPLETE_ADD_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failAddBucketTrigger(bucketName, error) {
    return {
        type: FAIL_ADD_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}

export function updateBucketTrigger(bucketName, triggerId, config) {

    return {
        type: UPDATE_BUCKET_TRIGGER,
        payload: { bucketName, triggerId, config }
    };
}

export function completeUpdateBucketTrigger(bucketName) {
    return {
        type: COMPLETE_UPDATE_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failUpdateBucketTrigger(bucketName, error) {
    return {
        type: FAIL_UPDATE_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}

export function removeBucketTrigger(bucketName, triggerId) {
    return {
        type: REMOVE_BUCKET_TRIGGER,
        payload: { bucketName, triggerId }
    };
}

export function completeRemoveBucketTrigger(bucketName) {
    return {
        type: COMPLETE_REMOVE_BUCKET_TRIGGER,
        payload: { bucketName }
    };
}

export function failRemoveBucketTrigger(bucketName, error) {
    return {
        type: FAIL_REMOVE_BUCKET_TRIGGER,
        payload: { bucketName, error }
    };
}
