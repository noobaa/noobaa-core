/* Copyright (C) 2016 NooBaa */
import zlib from 'zlib';
import { promisify } from 'utils/promise-utils';
import moment from 'moment';
import { DUMP_APP_LOG } from 'action-types';
import { Buffer } from 'buffer';
import { tap, mergeMap, scan, filter } from 'rxjs/operators';

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

export default async function (record$, { api, browser, getTime }) {
    const nbVersion = browser.getDocumentMetaTag('nbversion');
    const [,windowId] = browser.getWindowName().split(':');

    // Post each record to the debugChannel to be intercepted by the
    // debug console.
    const debugChannel = browser.createBroadcastChannel(`debugChannel:${windowId}`);
    const scanBase = {
        log: [],
        dumpToFile: false,
        sendToServer: false
    };

    record$.pipe(
        tap(record => debugChannel.postMessage({
            type: 'RECORD',
            origin: 'FE',
            payload: record
        })),
        mergeMap(async record => ({
            compressed: await _compress(JSON.stringify(record)),
            dumpToFile: record.action.type === DUMP_APP_LOG,
            sendToServer: Boolean(record.state.lastError)
        })),
        scan(({ log }, { compressed, dumpToFile, sendToServer }) => {
            // Add a compressed version of the record to the log.
            return {
                log: log.concat(compressed).slice(-maxLogSize),
                dumpToFile,
                sendToServer
            };
        }, scanBase),
        filter(({ sendToServer, dumpToFile }) => dumpToFile || sendToServer),
        mergeMap(async ({ log, dumpToFile, sendToServer }) => ({
            pkg: await _createDumpPkg(nbVersion, getTime(), log),
            dumpToFile,
            sendToServer
        }))
    ).subscribe(({ pkg, dumpToFile, sendToServer }) => {
        // Download the log on demand.
        if (dumpToFile) {
            browser.downloadFile(`data:application/zip;base64,${pkg.dump}`, pkg.name);
        }

        // Every time we get to an error state we gzip the last maxLogSize
        // records and send the gzip to the server to be archived and attached
        // to the next diagnostic pack download.
        if (sendToServer) {
            api.debug.upload_fe_dump(pkg);
        }
    });
}
