/* Copyright (C) 2016 NooBaa */

import { FETCH_SYSTEM_INFO } from 'action-types';
import { completeFetchSystemInfo, failFetchSystemInfo } from 'action-creators';
// import { sleep } from 'utils/promise-utils';

export default function(action$, { api }) {
    return action$
        .ofType(FETCH_SYSTEM_INFO)
        .switchMap(async () => {

            // await sleep(5000);

            try {
                const info = await api.system.read_system();
                return completeFetchSystemInfo(info);

            } catch (error) {
                return failFetchSystemInfo(error);
            }
        });
}
