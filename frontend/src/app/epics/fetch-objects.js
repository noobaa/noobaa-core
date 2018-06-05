/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_OBJECTS } from 'action-types';
import { completeFetchObjects, failFetchObjects } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_OBJECTS),
        mergeMap(async action => {
            const { query, s3Endpoint } = action.payload;

            try {
                const { bucket, filter, sortBy, order, skip, limit, stateFilter, versions } = query;

                let uploadMode;
                if (stateFilter !== 'ALL') uploadMode = false;
                if (stateFilter === 'UPLOADING') uploadMode = true;

                const response = await api.object.list_objects_admin({
                    bucket,
                    key_query: filter,
                    sort: sortBy,
                    order,
                    skip,
                    limit,
                    pagination: true,
                    upload_mode: uploadMode,
                    latest_versions: versions ? undefined : true,
                    filter_delete_markers: versions ? undefined : true,
                    adminfo: {
                        signed_url_endpoint: s3Endpoint
                    }
                });

                return completeFetchObjects(query, response);

            } catch (error) {
                return failFetchObjects(
                    query,
                    mapErrorObject(error)
                );
            }

        })
    );
}


