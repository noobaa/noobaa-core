/* Copyright (C) 2016 NooBaa */

import { switchMap } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { sleep } from 'utils/promise-utils';
import { refreshLocation } from 'action-creators';
import { COMPLETE_FETCH_SYSTEM_INFO } from 'action-types';

// A fixed delay added to the time left in order to compensate for the time it takes the server
// to get out of maintenance mode (where read_system returns { maintenance_mode: { state: true, time_left: 0 } })
// and prevent redundent refershs.
const GRACE_TIME = 500;

export default function(action$) {
    return action$.pipe(
        ofType(COMPLETE_FETCH_SYSTEM_INFO),
        switchMap(async action => {
            const { state, time_left = 0 } = action.payload.maintenance_mode;
            if (!state) return;

            await sleep(time_left + GRACE_TIME);
            return refreshLocation();
        })
    );
}
