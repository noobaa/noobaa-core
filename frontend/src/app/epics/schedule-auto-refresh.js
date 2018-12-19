/* Copyright (C) 2016 NooBaa */

import { map, debounceTime } from 'rxjs/operators';
import { ofType } from 'rx-extensions';
import { refreshLocation } from 'action-creators';
import { autoRefreshInterval } from 'config';
import { CHANGE_LOCATION, REFRESH_LOCATION } from 'action-types';

export default function(action$) {
    return action$.pipe(
        ofType(
            CHANGE_LOCATION,
            REFRESH_LOCATION
        ),
        debounceTime(autoRefreshInterval),
        map(() => refreshLocation())
    );
}
