/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_CLOUD_RESOURCE_OBJECTS } from 'action-types';
import {
    completeFetchCloudResourceObjects,
    failFetchCloudResourceObjects
} from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_CLOUD_RESOURCE_OBJECTS),
        mergeMap(async action => {
            const { resource, skip, limit } = action.payload;

            try {
                const { nodes: [node] } = await api.node.list_nodes({
                    query: {
                        pools: [resource]
                    }
                });

                const response = await api.object.read_node_mapping({
                    name: node.name,
                    skip: skip,
                    limit: limit,
                    adminfo: true
                });

                return completeFetchCloudResourceObjects(
                    resource,
                    skip,
                    limit,
                    response
                );

            } catch (error) {
                return failFetchCloudResourceObjects(
                    resource,
                    skip,
                    limit,
                    mapErrorObject(error)
                );
            }
        })
    );
}
