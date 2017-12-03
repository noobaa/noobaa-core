/* Copyright (C) 2016 NooBaa */

import { CREATE_HOSTS_POOL } from 'action-types';
import { completeCreateHostsPool, failCreateHostsPool } from 'action-creators';

export default  function(action$, { api }) {
    return action$
        .ofType(CREATE_HOSTS_POOL)
        .flatMap(async action => {
            const { name, hosts } = action.payload;

            try {
                await api.pool.create_hosts_pool({ name, hosts });
                return completeCreateHostsPool(name);

            } catch (error) {
                return failCreateHostsPool(name, error);
            }
        });
}
