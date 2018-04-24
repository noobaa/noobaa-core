/* Copyright (C) 2016 NooBaa */
import zlib from 'zlib';
import { promisify } from 'utils/promise-utils';
import moment from 'moment';
import { DUMP_APP_LOG } from 'action-types';
import { Buffer } from 'buffer';

const maxLogSize = 450;
const _compress = promisify(zlib.gzip);
const _decompress = promisify(zlib.gunzip);

function _createDumpPkg(nbVersion, time, log) {
    return new Promise(async resolve => {
        const buffers = [];
        const gzip =  zlib.createGzip();
        gzip.on('data', data => buffers.push(data));
        gzip.on('end', async () => {
            const timestamp = moment(time).format('YYYY_MM_DD-HH_mm_ss');
            const name = `nbfedump.${timestamp}.json.gz`;
            const dump = Buffer.concat(buffers).toString('base64');
            resolve({ name, dump });
        });

        gzip.write(`{"buildNubmer":"${nbVersion}","log":[`);
        for (let i = 0; i < log.length; ++i) {
            if (i > 0) gzip.write(',');
            gzip.write(await _decompress(log[i]));
        }
        gzip.end(']}');
    });
}


export default function (record$, { api, browser, getTime }) {
    const nbVersion = browser.getDocumentMetaTag('nbversion');
    const [,windowId] = browser.getWindowName().split(':');
    const debugChannel = browser.createBroadcastChannel(`debugChannel:${windowId}`);

    let log = [];
    record$.subscribe(async record => {
        const shouldDumpToFile = record.action.type === DUMP_APP_LOG;
        const shouldSendToServer = Boolean(record.state.lastError);

        // Post each record to the debugChannel to be intercept by the
        // debug console.
        debugChannel.postMessage(record);

        // Add a compressed version of the record to the log.
        log = log
            .concat(await _compress(JSON.stringify(record)))
            .slice(-maxLogSize);

        if (shouldDumpToFile || shouldSendToServer) {
            const pkg = await _createDumpPkg(nbVersion, getTime(), log);

            // Download the log in case on demand.
            if (shouldDumpToFile) {
                browser.downloadFile(`data:application/zip;base64,${pkg.dump}`, pkg.name);
            }

            // Every time we get to an error state we gzip the last maxLogSize
            // records and send the gzip to the server to be archived and attached
            // to the next diagnostic pack download.
            if (shouldSendToServer) {
                api.debug.upload_fe_dump(pkg);
            }
        }
    });
}
