/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_BUCKET } from 'action-types';
import { completeCreateBucket, failCreateBucket } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_BUCKET),
        mergeMap(async action => {
            const { name, placementType, resourceIds } = action.payload;

            try {
                const bucketInfo = await api.bucket.create_bucket({ name });

                // TODO: Find a better indication that we are going to use internal storage
                if (resourceIds.length > 0) {
                    await api.tier.update_tier({
                        name: bucketInfo.tiering.tiers[0].tier,
                        data_placement: placementType,
                        attached_pools: resourceIds.map(res => res.split(':')[1])
                    });
                }

                return completeCreateBucket(name);

            } catch (error) {
                return failCreateBucket(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}
