import * as model from 'model';
import { action$, state$ } from 'state';
import * as actionCreators from 'action-creators';
import schema from 'schema';
import api from 'services/api';
import { mapValues } from 'utils/core-utils';
import {
    toObjectUrl,
    openInNewTab,
    downloadFile,
    getWindowName
} from 'utils/browser-utils';

const logToConsole = console.log.bind(console);

const actions = mapValues(
    actionCreators,
    creator => function(...args) {
        action$.next(creator(...args));
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

function toggleApiLogging(enable = !api.rpc.get_request_logger()) {
    const logger = enable ? logToConsole : null;
    api.rpc.set_request_logger(logger);
    return Boolean(logger);
}

function togglePreviewContent() {
    actions.togglePreviewContent();
}

function dumpAppLog() {
    actions.dumpAppLog();
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
        dumpAppLog,
        togglePreviewContent
    }
});

state$.subscribe(state => {
    cli.state = state;
});

export default cli;
