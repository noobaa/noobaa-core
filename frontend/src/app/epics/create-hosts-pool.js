/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { CREATE_HOSTS_POOL } from 'action-types';
import { completeCreateHostsPool, failCreateHostsPool } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(CREATE_HOSTS_POOL),
        mergeMap(async action => {
            const { poolName, nodeCount, nodePvSize, isManaged } = action.payload;

            try {
                await api.pool.create_k8s_pool({
                    name: poolName,
                    config: {
                        node_count: nodeCount,
                        node_pv_size: nodePvSize,
                        is_managed: isManaged
                    }
                });

                return completeCreateHostsPool(poolName);

            } catch (error) {
                return failCreateHostsPool(
                    poolName,
                    mapErrorObject(error)
                );
            }
        })
    );
}

