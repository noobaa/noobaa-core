/* Copyright (C) 2016 NooBaa */

import { last } from 'utils/core-utils';
import JSZip from 'jszip';
import moment from 'moment';

const maxLogSize = 450;

function _reduceLog(log, record) {
    return log
        .concat(record)
        .slice(-maxLogSize);
}

async function _createPackage(nbVersion, log) {
    const timestamp = moment().format('YYYY_MM_DD-HH_mm_ss');
    const name = `nbfedump.${timestamp}.json`;
    const content = {
        buildNubmer: nbVersion,
        log: log
    };

    const zip = new JSZip();
    zip.file(name, JSON.stringify(content));
    const dump = await zip.generateAsync({
        type: 'base64',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 }
    });

    return {
        name: `${name}.zip`,
        dump: dump
    };
}


export default function (record$, { api, browser }) {
    const nbVersion = browser.getDocumentMetaTag('nbversion');

    // Post each record to the debugChannel to be intercept by the
    // debug console.
    const [,windowId] = browser.getWindowName().split(':');
    const debugChannel = browser.createBroadcastChannel(`debugChannel:${windowId}`);
    record$.subscribe(record => debugChannel.postMessage(record));

    // Every time we get to an error state we zip the last maxLogSize
    // records and send the zip to the server to be added to be archived
    // and attached to the next diagnostic pack download.
    record$
        .scan(_reduceLog, [])
        .filter(log => Boolean(last(log).state.lastError))
        .flatMap(log => _createPackage(nbVersion, log))
        .subscribe(pkg => api.debug.upload_fe_dump(pkg));
}
