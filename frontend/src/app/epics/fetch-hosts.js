/* Copyright (C) 2016 NooBaa */

import { FETCH_HOSTS } from 'action-types';
import { completeFetchHosts, failFetchHosts } from 'action-creators';
import { omitUndefined } from 'utils/core-utils';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_HOSTS)
        .flatMap(async action => {
            const { query, statistics } = action.payload;
            const { hosts, pools, name, modes, sortBy, order, skip,
                limit, recommendedHint } = query;

            try {
                return completeFetchHosts(
                    query,
                    await api.host.list_hosts(omitUndefined({
                        query: omitUndefined({
                            pools: pools,
                            filter: name,
                            mode: modes,
                            hosts: hosts
                        }),
                        sort: sortBy,
                        order: order,
                        recommended_hint: recommendedHint,
                        skip: skip,
                        limit: limit,
                        adminfo: statistics
                    }))
                );

            } catch (error) {
                return failFetchHosts(query, error);
            }
        });
}
