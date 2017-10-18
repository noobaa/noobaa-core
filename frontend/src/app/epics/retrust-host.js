/* Copyright (C) 2016 NooBaa */

import { RETRUST_HOST } from 'action-types';
import { completeRetrustHost, failRetrustHost } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(RETRUST_HOST)
        .flatMap(async action => {
            const { host } = action.payload;
            try {
                await api.host.retrust_host({ name: host });
                return completeRetrustHost(host);

            } catch (error) {
                return failRetrustHost(host, error);
            }
        });
}
