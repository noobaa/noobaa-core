/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { SET_SYSTEM_DEBUG_LEVEL } from 'action-types';
import { completeSetSystemDebugLevel, failSetSystemDebugLevel } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SET_SYSTEM_DEBUG_LEVEL),
        mergeMap(async action => {
            const { level } = action.payload;

            try {
                await api.cluster_server.set_debug_level({ level });
                return completeSetSystemDebugLevel(level);

            } catch (error) {
                return failSetSystemDebugLevel(
                    level,
                    mapErrorObject(error)
                );
            }
        })
    );
}
