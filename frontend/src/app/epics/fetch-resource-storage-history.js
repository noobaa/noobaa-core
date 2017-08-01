/* Copyright (C) 2016 NooBaa */

import { FETCH_RESOURCE_STORAGE_HISTORY } from 'action-types';
import { completeFetchResourceStorageHistory, failFetchResourceStorageHistory } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_RESOURCE_STORAGE_HISTORY)
        .switchMap(async () => {
            try {
                const poolHistory = await api.pool.get_pool_history({});
                return completeFetchResourceStorageHistory(poolHistory);

            } catch (error) {
                return failFetchResourceStorageHistory(error);
            }
        });
}