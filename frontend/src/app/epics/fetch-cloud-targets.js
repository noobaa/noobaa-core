/* Copyright (C) 2016 NooBaa */

import { FETCH_CLOUD_TARGETS } from 'action-types';
import { completeFetchCloudTargets, failFetchCloudTargets } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(FETCH_CLOUD_TARGETS)
        .flatMap(async action => {
            const { connection } = action.payload;

            try {
                const response = await api.bucket.get_cloud_buckets({ connection });
                return completeFetchCloudTargets(connection, response);
            } catch (error) {
                return failFetchCloudTargets(connection,  error);
            }
        });
}
