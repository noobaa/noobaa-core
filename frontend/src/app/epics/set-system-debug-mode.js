/* Copyright (C) 2016 NooBaa */

import { mapErrorObject } from 'utils/state-utils';
import { SET_SYSTEM_DEBUG_MODE } from 'action-types';
import { completeSetSystemDebugMode, failSetystemDebugMode } from 'action-creators';

export default function(action$, { api }) {
    return action$
        .ofType(SET_SYSTEM_DEBUG_MODE)
        .flatMap(async action => {
            const { on } = action.payload;
            try {
                await api.cluster_server.set_debug_level({ level: on ? 5 : 0 });

                return completeSetSystemDebugMode(on);
            } catch (error) {
                return failSetystemDebugMode(
                    on,
                    mapErrorObject(error)
                );
            }
        });
}
