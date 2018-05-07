/* Copyright (C) 2016 NooBaa */

import { switchMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { FETCH_SYSTEM_STORAGE_HISTORY } from 'action-types';
import { completeFetchSystemStorageHistory, failFetchSystemStorageHistory } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(FETCH_SYSTEM_STORAGE_HISTORY),
        switchMap(async () => {
            try {
                const history = await api.pool.get_pool_history({});
                return completeFetchSystemStorageHistory(history);

            } catch (error) {
                return failFetchSystemStorageHistory(mapErrorObject(error));
            }
        })
    );
}
