/* Copyright (C) 2016 NooBaa */

import { SET_HOST_DEBUG_MODE } from 'action-types';
import { completeSetHostDebugMode, failSetHostDebugMode } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(SET_HOST_DEBUG_MODE)
        .flatMap(async action => {
            const { host, on } = action.payload;

            try {
                await api.host.set_debug_host({
                    name: host,
                    level: on ? 5 : 0
                });

                return completeSetHostDebugMode(host, on);

            } catch (error) {
                return failSetHostDebugMode(host, on, error);
            }
        });
}
