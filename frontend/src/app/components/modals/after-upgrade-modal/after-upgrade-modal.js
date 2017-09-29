/* Copyright (C) 2016 NooBaa */

import template from './after-upgrade-modal.html';
import ko from 'knockout';
import { systemInfo } from 'model';

class AfterUpgradeModalViewModel {
    constructor({ onClose }) {
        this.close = onClose;
        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );
    }

    onClose() {
        this.close();
    }
}

export default {
    viewModel: AfterUpgradeModalViewModel,
    template: template
};
