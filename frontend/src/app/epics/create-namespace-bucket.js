/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_NAMESPACE_BUCKET } from 'action-types';
import { completeCreateNamespaceBucket, failCreateNamespaceBucket } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_NAMESPACE_BUCKET),
        mergeMap(async action => {
            const { name, readFrom, writeTo, caching } = action.payload;
            try {
                const namespace = {
                    read_resources: readFrom,
                    write_resource: writeTo,
                    caching: caching
                };

                await api.bucket.create_bucket({ name, namespace });
                return completeCreateNamespaceBucket(name);

            } catch (error) {
                return failCreateNamespaceBucket(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}
