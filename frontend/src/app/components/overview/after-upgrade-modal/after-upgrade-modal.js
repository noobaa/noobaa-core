import template from './after-upgrade-modal.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';

class AfterUpgradeModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: AfterUpgradeModalViewModel,
    template: template
};
