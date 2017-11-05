import { FETCH_BUCKET_OBJECTS } from 'action-types';
import { completeFetchBucketObjects, failFetchBucketObjects } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(FETCH_BUCKET_OBJECTS)
        .flatMap(async action => {
            const { bucket, filter, sortBy, order, skip, limit, stateFilter } = action.payload.query;

            try {
                let uploadMode;
                if (stateFilter !== 'ALL') uploadMode = false;
                if (stateFilter === 'UPLOADING') uploadMode = true;

                const response = await api.object.list_objects({
                    bucket,
                    key_query: filter,
                    sort: sortBy,
                    order,
                    skip,
                    limit,
                    pagination: true,
                    upload_mode: uploadMode
                });

                return completeFetchBucketObjects(action.payload.query, response);
            } catch (error) {
                return failFetchBucketObjects(action.payload.query, error);
            }
        });
}
