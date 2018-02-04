/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { DELETE_RESOURCE } from 'action-types';
import { completeDeleteResource, failDeleteResource } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_RESOURCE)
        .flatMap(async action => {
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
        });
}
