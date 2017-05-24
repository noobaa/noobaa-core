import { dispatch } from 'state';
import api from 'services/api';
import { START_UPDATE_BUCKET_QUOTA, COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA } from 'action-types';

export async function updateBucketQuota(bucket, quota) {
    dispatch({
        type: START_UPDATE_BUCKET_QUOTA,
        payload: { bucket, quota }
    });

    try {
        await api.bucket.update_bucket({ name: bucket, quota });
        dispatch({
            type: COMPLETE_UPDATE_BUCKET_QUOTA,
            payload: { bucket }
        });

    } catch (error) {
        dispatch({
            type: FAIL_UPDATE_BUCKET_QUOTA,
            payload: { bucket, error }
        });
    }
}
