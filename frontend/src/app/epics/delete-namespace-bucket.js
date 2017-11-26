import { DELETE_NAMESPACE_BUCKET } from 'action-types';
import { completeDeleteNamespaceBucket, failDeleteNamespaceBucket } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(DELETE_NAMESPACE_BUCKET)
        .flatMap(async action => {
            const { name } = action.payload;

            try {
                await api.bucket.delete_bucket({ name });
                return completeDeleteNamespaceBucket(name);

            } catch (error) {
                return failDeleteNamespaceBucket(name, error);
            }
        });
}
