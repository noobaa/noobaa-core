/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { ASSIGN_REGION_TO_RESOURCE } from 'action-types';
import { completeAssignRegionToResource, failAssignRegionToResource } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(ASSIGN_REGION_TO_RESOURCE),
        mergeMap(async action => {
            const { resourceType, resourceName, region } = action.payload;
            try {
                await api.pool.assign_pool_to_region({
                    name: resourceName,
                    region: region
                });

                return completeAssignRegionToResource(
                    resourceType,
                    resourceName,
                    region
                );

            } catch (error) {
                return failAssignRegionToResource(
                    resourceType,
                    resourceName,
                    region,
                    mapErrorObject(error)
                );
            }
        })
    );
}
