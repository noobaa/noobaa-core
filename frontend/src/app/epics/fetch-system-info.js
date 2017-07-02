/* Copyright (C) 2016 NooBaa */

import { FETCH_SYSTEM_INFO } from 'action-types';
import { completeFetchSystemInfo, failFetchSystemInfo } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_SYSTEM_INFO)
        .switchMap(async () => {
            try {
                const info = await api.system.read_system();
                return completeFetchSystemInfo(info);

            } catch (error) {
                return failFetchSystemInfo(error);
            }
        });
}
