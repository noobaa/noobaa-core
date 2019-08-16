/* Copyright (C) 2016 NooBaa */

import { deepFreeze } from 'utils/core-utils';
import { map } from 'rxjs/operators';
import {
    COMPLETE_COLLECT_HOST_DIAGNOSTICS,
    COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS,
    COMPLETE_CREATE_HOSTS_POOL
} from 'action-types';

const actionToFileInfo = deepFreeze({
    [COMPLETE_COLLECT_HOST_DIAGNOSTICS]: payload => ({ uri: payload.packageUri }),
    [COMPLETE_COLLECT_SYSTEM_DIAGNOSTICS]: payload => ({ uri: payload.packageUri }),
    [COMPLETE_CREATE_HOSTS_POOL]: payload => payload.autoDownload ? {
        uri: payload.deployYAMLUri,
        name: `${payload.name}.yaml`
    } : null
});

export default function(action$, { browser }) {
    return action$.pipe(
        map(action => {
            const getFileInfo = actionToFileInfo[action.type];
            if (!getFileInfo) return;

            const fileInfo = getFileInfo(action.payload);
            if (!fileInfo) return;

            browser.downloadFile(fileInfo.uri, fileInfo.name);
        })
    );
}
