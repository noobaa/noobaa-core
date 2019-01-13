/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_HOST_OBJECTS } from 'action-types';
import { completeFetchHostObjects, failFetchHostObjects } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_HOST_OBJECTS),
        mergeMap(async action => {
            const { host, skip, limit } = action.payload;

            try {
                const response = await api.object.read_node_mapping({
                    name: host,
                    by_host: true,
                    skip: skip,
                    limit: limit,
                    adminfo: true
                });

                return completeFetchHostObjects(host, skip, limit, response);

            } catch (error) {
                return failFetchHostObjects(
                    host,
                    skip,
                    limit,
                    mapErrorObject(error)
                );
            }
        })
    );
}
