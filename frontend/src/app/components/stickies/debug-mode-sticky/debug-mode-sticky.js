/* Copyright (C) 2016 NooBaa */

import template from './debug-mode-sticky.html';
import Observer from 'observer';
import ko from 'knockout';
import { action$, state$ } from 'state';
import { unsetSystemDebugMode } from 'action-creators';

class DebugModeStickyViewModel extends Observer {
    isActive = ko.observable();

    constructor() {
        super();

        this.observe(state$.get('system', 'debugMode'), this.onState);
    }

    onState(debugMode) {
        this.isActive(Boolean(debugMode));
    }

    onUnsetDebugMode() {
        action$.onNext(unsetSystemDebugMode());
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

