import { UPDATE_GATEWAY_BUCKET_PLACEMENT } from 'action-types';
import { completeUpdateGatewayBucketPlacement, failUpdateGatewayBucketPlacement } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(UPDATE_GATEWAY_BUCKET_PLACEMENT)
        .flatMap(async action => {
            const { name, readFrom, writeTo } = action.payload;

            try {
                const namespace = {
                    read_resources: readFrom,
                    write_resource: writeTo
                };

                await api.bucket.update_bucket({ name, namespace });
                return completeUpdateGatewayBucketPlacement(name);

            } catch (error) {
                return failUpdateGatewayBucketPlacement(name, error);
            }
        });
}
