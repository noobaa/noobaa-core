import * as model from 'model';
import { action$, state$, appLog$ } from 'state';
import * as actionCreators from 'action-creators';
import schema from 'schema';
import api from 'services/api';
import { mapValues, noop } from 'utils/core-utils';
import { createDumpPkg } from 'utils/debug-utils';
import {
    toObjectUrl,
    openInNewTab,
    downloadFile,
    getWindowName,
    getDocumentMetaTag
} from 'utils/browser-utils';

const actions = mapValues(
    actionCreators,
    creator => function(...args) {
        action$.onNext(creator(...args));
    }
);

function printAsJsonInNewTab(data) {
    openInNewTab(toObjectUrl(data));
}

function downloadAsJson(data, name = 'data.json') {
    downloadFile(toObjectUrl(data), name);
}

function openDebugConsole() {
    const [,windowId] = getWindowName().split(':');
    openInNewTab('/fe/debug', `NobaaDebugConsole:${windowId}`);
    return windowId;
}

function toggleApiLogging(enable = false) {
    const logger = enable ?
        console.log.bind(console) :
        noop;

    api.rpc.set_request_logger(logger);
}

function dumpAppLog() {
    const nbVersion = getDocumentMetaTag('nbversion');

    appLog$
        .take(1)
        .flatMap(log => createDumpPkg(nbVersion, log))
        .subscribe(pkg => {
            const { name, dump } = pkg;
            downloadFile(`data:application/zip;base64,${dump}`, name);
        });
}

const cli = Object.seal({
    model: model,
    schema: schema.def,
    actions: actions,
    state: undefined,
    api: api,
    utils: {
        printAsJsonInNewTab,
        downloadAsJson,
        openDebugConsole,
        toggleApiLogging,
        dumpAppLog
    }
});

state$.subscribe(state => {
    cli.state = state;
});

export default cli;
