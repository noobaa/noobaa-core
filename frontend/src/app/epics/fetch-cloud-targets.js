/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_CLOUD_TARGETS } from 'action-types';
import { completeFetchCloudTargets, failFetchCloudTargets } from 'action-creators';

export default  function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_CLOUD_TARGETS),
        mergeMap(async action => {
            const { connection } = action.payload;

            try {
                const response = await api.bucket.get_cloud_buckets({ connection });
                return completeFetchCloudTargets(connection, response);

            } catch (error) {
                return failFetchCloudTargets(
                    connection,
                    mapErrorObject(error)
                );
            }
        })
    );
}
