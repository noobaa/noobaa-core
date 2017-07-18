/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import 'knockout-projections';
import 'knockout-validation';
import 'knockout-extensions';
import 'rx-extentions';
import registerExtenders from 'extenders/register';
import registerValidationRules from 'validations';
import registerBindings from 'bindings/register';
import registerComponents from 'components/register';
import page from 'page';
import configureRouter from 'routing';
import { action$, state$ } from 'state';
import { api, AWS } from 'services';
import { restoreSession } from 'action-creators';
import devCLI from 'dev-cli';
import actionsModelBridge from 'actions-model-bridge';
import rootEpic from 'epics';
import installStateSideEffects from 'state-side-effects';
import { downloadFile } from 'utils/browser-utils';

function configureKnockout(ko) {
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
    registerComponents(ko);
}

function registerSideEffects(action$, state$) {
    const injectedServices = {
        random: Math.random,
        getTime: Date.now,
        localStorage: localStorage,
        sessionStorage: sessionStorage,
        fetch: fetch,
        S3: AWS.S3,
        api: api,
        router: page,
        downloadFile: downloadFile
    };

    rootEpic(action$, injectedServices)
        .filter(Boolean)
        .subscribe(action$);

    installStateSideEffects(state$, injectedServices);
}

configureKnockout(ko);

// Configure the appliction router.
configureRouter(page);

registerSideEffects(action$, state$);

// Bridge between the action stream and the old model
actionsModelBridge(action$);

// Mount dev cli on the global scope.
global.nb = devCLI;

// Bind the ui to the
ko.applyBindings(null);

action$.onNext(restoreSession());


