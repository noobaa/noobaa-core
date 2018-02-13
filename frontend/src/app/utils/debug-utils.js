/* Copyright (C) 2016 NooBaa */

import moment from 'moment';
import JSZip from 'jszip';

export async function createDumpPkg(appVersion, appLog) {
    const timestamp = moment().format('YYYY_MM_DD-HH_mm_ss');
    const name = `nbfedump.${timestamp}.json`;
    const content = {
        buildNubmer: appVersion,
        log: appLog
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
