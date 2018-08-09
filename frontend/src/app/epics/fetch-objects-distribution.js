/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_OBJECTS_DISTRIBUTION } from 'action-types';
import { completeFetchObjectsDistribution, failFetchObjectsDistribution  } from 'action-creators';


export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_OBJECTS_DISTRIBUTION),
        mergeMap(async () => {
            try {
                const distribution = await api.bucket.get_objects_size_histogram();
                return completeFetchObjectsDistribution(distribution);

            } catch (error) {
                return failFetchObjectsDistribution(mapErrorObject(error));
            }
        })
    );
}
