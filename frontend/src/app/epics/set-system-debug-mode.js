/* Copyright (C) 2016 NooBaa */

import { ofType } from 'rx-extensions';
import { mergeMap } from 'rxjs/operators';
import { mapErrorObject } from 'utils/state-utils';
import { SET_SYSTEM_DEBUG_MODE } from 'action-types';
import { completeSetSystemDebugMode, failSetSystemDebugMode } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SET_SYSTEM_DEBUG_MODE),
        mergeMap(async action => {
            const { on } = action.payload;
            try {
                await api.cluster_server.set_debug_level({ level: on ? 5 : 0 });

                return completeSetSystemDebugMode(on);
            } catch (error) {
                return failSetSystemDebugMode(
                    on,
                    mapErrorObject(error)
                );
            }
        })
    );
}
