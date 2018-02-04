/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { FETCH_OBJECT_PARTS } from 'action-types';
import { completeFetchObjectParts, failFetchObjectParts } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(FETCH_OBJECT_PARTS)
        .flatMap(async action => {
            const query = action.payload;

            try {
                const { parts } = await api.object.read_object_mappings({
                    bucket: query.bucket,
                    key: query.key,
                    skip: query.skip,
                    limit: query.limit,
                    adminfo: true
                });

                return completeFetchObjectParts(query, parts);

            } catch (error) {
                return failFetchObjectParts(
                    query,
                    mapErrorObject(error)
                );
            }
        });
}
