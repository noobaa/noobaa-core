/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { ASSIGN_HOSTS_TO_POOL } from 'action-types';
import { completeAssignHostsToPool, failAssignHostsToPool } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(ASSIGN_HOSTS_TO_POOL)
        .flatMap(async action => {
            const { pool: name, hosts } = action.payload;

            try {
                await api.pool.assign_hosts_to_pool({ name, hosts });
                return completeAssignHostsToPool(name, hosts);

            } catch (error) {
                return failAssignHostsToPool(
                    name,
                    mapErrorObject(error)
                );
            }
        });
}
