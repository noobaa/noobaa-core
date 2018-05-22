/* Copyright (C) 2016 NooBaa */

import { ofType } from 'rx-extensions';
import { mergeMap } from 'rxjs/operators';
import { mapErrorObject } from 'utils/state-utils';
import { SET_SERVER_DEBUG_MODE } from 'action-types';
import { completeSetServerDebugMode, failSetServerDebugMode } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SET_SERVER_DEBUG_MODE),
        mergeMap(async action => {
            const { secret, hostname, on } = action.payload;

            try {
                await api.cluster_server.set_debug_level({
                    target_secret: secret,
                    level: on ? 5 : 0
                });

                return completeSetServerDebugMode(secret, hostname, on);
            } catch (error) {
                return failSetServerDebugMode(
                    secret,
                    hostname,
                    on,
                    mapErrorObject(error)
                );
            }
        })
    );
}
