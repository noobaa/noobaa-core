import { CREATE_GATEWAY_BUCKET } from 'action-types';
import { completeCreateGatewayBucket, failCreateGatewayBucket } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(CREATE_GATEWAY_BUCKET)
        .flatMap(async action => {
            const { name, readFrom, writeTo } = action.payload;

            try {
                const namespace = {
                    read_resources: readFrom,
                    write_resource: writeTo
                };

                await api.bucket.create_bucket({ name, namespace });
                return completeCreateGatewayBucket(name);

            } catch (error) {
                return failCreateGatewayBucket(name, error);
            }
        });
}
