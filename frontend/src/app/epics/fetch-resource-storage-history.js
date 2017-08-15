/* Copyright (C) 2016 NooBaa */

import { FETCH_RESOURCE_STORAGE_HISTORY } from 'action-types';
import { completeFetchResourceStorageHistory, failFetchResourceStorageHistory } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_RESOURCE_STORAGE_HISTORY)
        .switchMap(async () => {
            try {
                return completeFetchResourceStorageHistory(await api.pool.get_pool_history({}));
            } catch (error) {
                return failFetchResourceStorageHistory(error);
            }
        });
}

