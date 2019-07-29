/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { SCALE_HOSTS_POOL } from 'action-types';
import { completeScaleHostsPool, failScaleHostsPool } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SCALE_HOSTS_POOL),
        mergeMap(async action => {
            const { poolName, hostCount } = action.payload;

            try {
                await api.pool.scale_hosts_pool({
                    name: poolName,
                    host_count: hostCount
                });

                return completeScaleHostsPool(poolName);

            } catch (error) {
                return failScaleHostsPool(
                    poolName,
                    mapErrorObject(error)
                );
            }
        })
    );
}

