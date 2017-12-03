/* Copyright (C) 2016 NooBaa */

import { CREATE_NAMESPACE_BUCKET } from 'action-types';
import { completeCreateNamespaceBucket, failCreateNamespaceBucket } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(CREATE_NAMESPACE_BUCKET)
        .flatMap(async action => {
            const { name, readFrom, writeTo } = action.payload;

            try {
                const namespace = {
                    read_resources: readFrom,
                    write_resource: writeTo
                };

                await api.bucket.create_bucket({ name, namespace });
                return completeCreateNamespaceBucket(name);

            } catch (error) {
                return failCreateNamespaceBucket(name, error);
            }
        });
}
