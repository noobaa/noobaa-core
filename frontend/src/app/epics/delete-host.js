/* Copyright (C) 2016 NooBaa */

import { DELETE_HOST } from 'action-types';
import { completeDeleteHost, failDeleteHost } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(DELETE_HOST)
        .flatMap(async action => {
            const { host } = action.payload;
            try {
                await api.host.delete_host({ name: host });
                return completeDeleteHost(host);

            } catch (error) {
                return failDeleteHost(host, error);
            }
        });
}
