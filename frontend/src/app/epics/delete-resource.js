/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { DELETE_RESOURCE } from 'action-types';
import { completeDeleteResource, failDeleteResource } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(DELETE_RESOURCE),
        mergeMap(async action => {
            const { resource } = action.payload;
            try {
                await api.pool.delete_pool({ name: resource });
                return completeDeleteResource(resource);

            } catch (error) {
                return failDeleteResource(
                    resource,
                    mapErrorObject(error)
                );
            }
        })
    );
}
