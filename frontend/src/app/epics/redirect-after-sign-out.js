/* Copyright (C) 2016 NooBaa */

import { map, delay } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { SIGN_OUT } from 'action-types';
import { requestLocation } from 'action-creators';

export default function(action$) {
    // Adding the delay in order to enusre that the UI has refreshed before changing to the new location,
    // This prevents view models who are relaying on some url params (e.g. system param) from throwing.
    // The dealy gurentee that these view model will be destroied before the change
    return action$.pipe(
        ofType(SIGN_OUT),
        delay(1),
        map(() => requestLocation('/'))
    );
}
