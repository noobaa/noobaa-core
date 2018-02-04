/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_NAMESPACE_BUCKET_PLACEMENT } from 'action-types';
import { completeUpdateNamespaceBucketPlacement, failUpdateNamespaceBucketPlacement } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(UPDATE_NAMESPACE_BUCKET_PLACEMENT)
        .flatMap(async action => {
            const { name, readFrom, writeTo } = action.payload;

            try {
                const namespace = {
                    read_resources: readFrom,
                    write_resource: writeTo
                };

                await api.bucket.update_bucket({ name, namespace });
                return completeUpdateNamespaceBucketPlacement(name);

            } catch (error) {
                return failUpdateNamespaceBucketPlacement(
                    name,
                    mapErrorObject(error)
                );
            }
        });
}
