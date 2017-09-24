import { DELETE_GATEWAY_BUCKET } from 'action-types';
import { completeDeleteGatewayBucket, failDeleteGatewayBucket } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(DELETE_GATEWAY_BUCKET)
        .flatMap(async action => {
            const { name } = action.payload;

            try {
                await api.bucket.delete_bucket({ name });
                return completeDeleteGatewayBucket(name);

            } catch (error) {
                return failDeleteGatewayBucket(name, error);
            }
        });
}
