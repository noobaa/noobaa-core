/* Copyright (C) 2016 NooBaa */

import { mergeMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { mapErrorObject } from 'utils/state-utils';
import { SET_HOST_DEBUG_MODE } from 'action-types';
import { completeSetHostDebugMode, failSetHostDebugMode } from 'action-creators';

export default function(action$, { api }) {
    return action$.pipe(
        ofType(SET_HOST_DEBUG_MODE),
        mergeMap(async action => {
            const { host, on } = action.payload;

            try {
                await api.host.set_debug_host({
                    name: host,
                    level: on ? 5 : 0
                });

                return completeSetHostDebugMode(host, on);

            } catch (error) {
                return failSetHostDebugMode(
                    host,
                    on,
                    mapErrorObject(error)
                );
            }
        })
    );
}
