/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { map } from 'rxjs/operators';
import { COMPLETE_COLLECT_HOST_DIAGNOSTICS, COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS } from 'action-types';


const actionToUriAccessor = deepFreeze({
    [COMPLETE_COLLECT_HOST_DIAGNOSTICS]: payload => payload.packageUri,
    [COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS]: payload => payload.packageUri
});

export default function(action$, { browser }) {
    return action$.pipe(
        map(action => {
            const uriAccessor = actionToUriAccessor[action.type];
            if (!uriAccessor) return;

            const uri = uriAccessor(action.payload);
            if (!uri) return;

            browser.downloadFile(uri);
        })
    );
}
