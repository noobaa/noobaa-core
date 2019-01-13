/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_OBJECT_PARTS } from 'action-types';
import { completeFetchObjectParts, failFetchObjectParts } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_OBJECT_PARTS),
        mergeMap(async action => {
            const query = action.payload;

            try {
                const { chunks } = await api.object.read_object_mapping_admin({
                    bucket: query.bucket,
                    key: query.key,
                    version_id: query.version,
                    skip: query.skip,
                    limit: query.limit
                });

                return completeFetchObjectParts(query, chunks);

            } catch (error) {
                return failFetchObjectParts(
                    query,
                    mapErrorObject(error)
                );
            }
        })
    );
}
