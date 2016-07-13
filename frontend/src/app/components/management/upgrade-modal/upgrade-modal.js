import template from './upgrade-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { upgradeStatus } from 'model';

class UpgradeModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        let step = ko.pureComputed(
            () => upgradeStatus() && upgradeStatus().step
        );

        this.progress = ko.pureComputed(
            () => upgradeStatus() ? upgradeStatus().progress : 0
        );

        this.upgradeFailed = ko.pureComputed(
            () => !!upgradeStatus() && upgradeStatus().state === 'FAILED'
        );

        this.stepClass = ko.pureComputed(
            () => (step() || '').toLowerCase()
        );

        this.progressText = ko.pureComputed(
            () => step() === 'UPLOAD' ?
                `Uploading Package ${numeral(this.progress()).format('0%')}` :
                'Installing Package...'
        );
    }

    close() {
        if (this.upgradeFailed()) {
            this.onClose();
        }
    }
}

export default {
    viewModel: UpgradeModalViewModel,
    template: template
};
