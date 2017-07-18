/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { COMPLETE_COLLECT_HOST_DIAGNOSTICS } from 'action-types';

const actionToUriAccessor = deepFreeze({
    [COMPLETE_COLLECT_HOST_DIAGNOSTICS]: payload => payload.packageUri
});

export default function(action$, { downloadFile }) {
    return action$
        .map(action => {
            const uriAccessor = actionToUriAccessor[action.type];
            if (!uriAccessor) return;

            const uri = uriAccessor(action.payload);
            if (!uri) return;

            downloadFile(uri);
        });
}
