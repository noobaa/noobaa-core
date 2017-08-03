/* Copyright (C) 2016 NooBaa */

import { FETCH_HOSTS } from 'action-types';
import { completeFetchHosts, failFetchHosts } from 'action-creators';
import { sleep } from 'utils/promise-utils';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_HOSTS)
        .flatMap(async action => {
            const { query } = action.payload;
            const { hosts, pools, name, modes, sortBy, order, skip, limit } = query;

            try {
                // await sleep(3000);

                return completeFetchHosts(
                    query,
                    await api.host.list_hosts({
                        query: {
                            pools: pools,
                            filter: name,
                            mode: modes,
                            hosts: hosts
                        },
                        sort: sortBy,
                        order: order,
                        skip: skip,
                        limit: limit
                    })
                );

            } catch (error) {
                return failFetchHosts(query, error);
            }
        });
}
