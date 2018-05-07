/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_CLOUD_RESOURCE } from 'action-types';
import { completeCreateCloudResource, failCreateCloudResource } from 'action-creators';

export default  function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_CLOUD_RESOURCE),
        mergeMap(async action => {
            const { name, connection, target: target_bucket } = action.payload;

            try {
                await api.pool.create_cloud_pool({ name, connection, target_bucket });
                return completeCreateCloudResource(name);
            } catch (error) {
                return failCreateCloudResource(
                    name,
                    mapErrorObject(error)
                );
            }
        })
    );
}
