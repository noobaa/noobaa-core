import { dispatch } from 'state';
import api from 'services/api';
import { START_UPDATE_BUCKET_QUOTA, COMPLETE_UPDATE_BUCKET_QUOTA, FAIL_UPDATE_BUCKET_QUOTA,
         START_UPDATE_BUCKET_INTERNAL_SPILLOVER, COMPLETE_UPDATE_BUCKET_INTERNAL_SPILLOVER,
         FAIL_UPDATE_BUCKET_INTERNAL_SPILLOVER } from 'action-types';

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

export async function updateBucketInternalSpillover(bucket, spilloverEnabled) {
    dispatch({
        type: START_UPDATE_BUCKET_INTERNAL_SPILLOVER,
        payload: { bucket, spilloverEnabled }
    });

    try {
        await api.bucket.update_bucket({ name: bucket, use_internal_spillover: spilloverEnabled });
        dispatch({
            type: COMPLETE_UPDATE_BUCKET_INTERNAL_SPILLOVER,
            payload: { bucket, spilloverEnabled }
        });

    } catch (error) {
        dispatch({
            type: FAIL_UPDATE_BUCKET_INTERNAL_SPILLOVER,
            payload: { bucket, error }
        });
    }
}
