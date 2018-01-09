/* Copyright (C) 2016 NooBaa */

import template from './debug-mode-sticky.html';
import BaseViewModel from 'components/base-view-model';
import { systemInfo } from 'model';
import { setSystemDebugLevel } from 'actions';
import ko from 'knockout';

class DebugModeStickyViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => !!systemInfo() && systemInfo().debug.level > 0
        );
    }

    lowerDebugLevel() {
        setSystemDebugLevel(0);
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

