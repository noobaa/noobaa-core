/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import 'knockout-extensions';
import { filter } from 'rxjs/operators';
import registerExtenders from 'extenders/register';
import registerValidationRules from 'validations';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import page from 'page';
import configureRouter from 'routing';
import { action$, state$, record$ } from 'state';
import { api, AWS, bufferStore } from 'services';
import { restoreSession, setupEnv } from 'action-creators';
import devCLI from 'dev-cli';
import actionsModelBridge from 'actions-model-bridge';
import rootEpic from 'epics';
import installStateSideEffects from 'state-side-effects';
import installSupportability from 'supportability.js';
import config from 'config';
import { deepAssign, noop } from 'utils/core-utils';
import {
    recognizeBrowser,
    downloadFile,
    reloadBrowser,
    httpRequest,
    httpWaitForResponse,
    createBroadcastChannel,
    getDocumentMetaTag,
    getWindowName
} from 'utils/browser-utils';



function configureKnockout(ko) {
    const injectedServices = {
        api,
        state$,
        action$
    };

    // Enable knockout 3.4 deferred updates.
    ko.options.deferUpdates = true;

    // Setup validation policy.
    ko.validation.init({
        errorMessageClass: 'val-msg',
        decorateInputElement: true,
        errorElementClass: 'invalid',
        errorsAsTitle: false,
        messagesOnModified: true,
        writeInputAttributes: true
    });

    // Register custom extenders, bindings, components and validation rules.
    registerExtenders(ko);
    registerBindings(ko);
    registerValidationRules(ko);
    registerComponents(ko, injectedServices);
}

function registerSideEffects(action$, state$) {
    const borwser = {
        reload: reloadBrowser,
        downloadFile: downloadFile,
        httpRequest: httpRequest,
        httpWaitForResponse: httpWaitForResponse,
        createBroadcastChannel: createBroadcastChannel,
        getDocumentMetaTag: getDocumentMetaTag,
        getWindowName: getWindowName
    };

    const injectedServices = {
        random: Math.random,
        getTime: Date.now,
        localStorage: localStorage,
        sessionStorage: sessionStorage,
        fetch: fetch,
        AWS: AWS,
        api: api,
        router: page,
        browser: borwser,
        bufferStore: bufferStore
    };

    rootEpic(action$, injectedServices)
        .pipe(filter(Boolean))
        .subscribe(action$);

    installSupportability(record$, injectedServices);
    installStateSideEffects(state$, injectedServices);
}

async function patchConfig() {
    try {
        const response = await fetch(config.patchFile);
        try {
            const patch = await response.json();
            deepAssign(config, patch);
            console.info(`PATH_CONFIG ${config.patchFile}`);

        } catch (err) {
            console.warn(`PATCH_CONFIG malformed file ${config.patchFile}: ${err.message}`);
        }

    } catch (_) {
        noop();
    }
}

async function main() {
    // Patch the app configuration using a server served patch file.
    await patchConfig();

    configureKnockout(ko);

    // Configure the appliction router.
    configureRouter(page);

    registerSideEffects(action$, state$);

    // Bridge between the action stream and the old model
    actionsModelBridge(action$);

    // Mount dev cli on the global scope.
    global.nb = devCLI;

    // Bind the ui to the
    ko.applyBindings(null, document.querySelector('app'));

    action$.next(setupEnv(recognizeBrowser()));
    action$.next(restoreSession());
}

main();
