/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { TOGGLE_BUCKETS_SPILLOVER } from 'action-types';
import { completeToggleBucketsSpillover, failToggleBucketsSpillover } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(TOGGLE_BUCKETS_SPILLOVER)
        .flatMap(async action => {
            const request = Object.entries(action.payload)
                .map(pair => ({
                    name: pair[0],
                    use_internal_spillover: pair[1]
                }));

            try {
                await api.bucket.update_buckets(request);
                return completeToggleBucketsSpillover();

            } catch (error) {
                return failToggleBucketsSpillover(mapErrorObject(error));
            }
        });
}
