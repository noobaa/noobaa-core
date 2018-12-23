/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { UPDATE_NAMESPACE_BUCKET_PLACEMENT } from 'action-types';
import { completeUpdateNamespaceBucketPlacement, failUpdateNamespaceBucketPlacement } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(UPDATE_NAMESPACE_BUCKET_PLACEMENT),
        mergeMap(async action => {
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
        })
    );
}
