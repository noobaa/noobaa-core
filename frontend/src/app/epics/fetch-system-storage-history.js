/* Copyright (C) 2016 NooBaa */

import { FETCH_SYSTEM_STORAGE_HISTORY } from 'action-types';
import { completeFetchSystemStorageHistory, failFetchSystemStorageHistory } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_SYSTEM_STORAGE_HISTORY)
        .switchMap(async () => {
            try {
                const history = await api.pool.get_pool_history({});
                return completeFetchSystemStorageHistory(history);

            } catch (error) {
                return failFetchSystemStorageHistory(error);
            }
        });
}
