import template from './after-upgrade-modal.html';
import ko from 'knockout';
import { systemInfo } from 'model';

class AfterUpgradeModal {
    constructor({ onClose }) {
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
    viewModel: AfterUpgradeModal,
    template: template
};
