/* Copyright (C) 2016 NooBaa */

import { last } from 'utils/core-utils';
import { createDumpPkg } from 'utils/debug-utils';

export default function (appLog$, { api, browser }) {
    const nbVersion = browser.getDocumentMetaTag('nbversion');

    // Post each record to the debugChannel to be intercept by the
    // debug console.
    const [,windowId] = browser.getWindowName().split(':');
    const debugChannel = browser.createBroadcastChannel(`debugChannel:${windowId}`);
    appLog$
        .map(log => last(log))
        .subscribe(record => debugChannel.postMessage(record));

    // Every time we get to an error state we zip the last maxLogSize
    // records and send the zip to the server to be added to be archived
    // and attached to the next diagnostic pack download.
    appLog$
        .filter(log => Boolean(last(log).state.lastError))
        .flatMap(log => createDumpPkg(nbVersion, log))
        .subscribe(pkg => api.debug.upload_fe_dump(pkg));
}
