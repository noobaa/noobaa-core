import { FETCH_BUCKET_OBJECTS } from 'action-types';
import { completeFetchBucketObjects, failFetchBucketObjects } from 'action-creators';
import config from 'config';

export default  function(action$, { api }) {
    return action$
        .ofType(FETCH_BUCKET_OBJECTS)
        .flatMap(async action => {
            const { bucketName, filter, sortBy, order, page, uploadMode } = action.payload;

            try {
                const response = await api.object.list_objects({
                    bucket: bucketName,
                    key_query: filter,
                    sort: sortBy,
                    order: order,
                    skip: config.paginationPageSize * page,
                    limit: config.paginationPageSize,
                    pagination: true,
                    upload_mode: uploadMode
                });
                return completeFetchBucketObjects(bucketName, filter, sortBy, order, page, uploadMode, response);

            } catch (error) {
                return failFetchBucketObjects(bucketName, filter, sortBy, order, page, uploadMode, error);
            }
        });
}
