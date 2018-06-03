/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { randomString } from 'utils/string-utils';
import { CREATE_BUCKET } from 'action-types';
import { completeCreateBucket, failCreateBucket } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_BUCKET),
        mergeMap(async action => {
            const { name, placementType, resources } = action.payload;

            try {
                // Using random string in the case where one of the calls before crete_bucet fails
                // in order to not lock the tier/policy name for a second try.
                const bucketWithSuffix = `${name}#${randomString()}`;
                const tier = await api.tier.create_tier({
                    name: bucketWithSuffix,
                    data_placement: placementType,
                    attached_pools: resources
                });
                const policy = {
                    name: bucketWithSuffix,
                    tiers: [ { order: 0, tier: tier.name } ]
                };
                await api.tiering_policy.create_policy(policy);
                await api.bucket.create_bucket({
                    name: name,
                    tiering: policy.name
                });


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
