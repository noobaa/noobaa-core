/* Copyright (C) 2016 NooBaa */

import template from './system-upgrade-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { upgradeStatus } from 'model';
import { support } from 'config';

class UpgradeModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        let step = ko.pureComputed(
            () => upgradeStatus() && upgradeStatus().step
        );

        this.progress = ko.pureComputed(
            () => upgradeStatus() ?
                (upgradeStatus().step === 'UPLOAD' ? upgradeStatus().progress : 1) :
                0
        );

        this.upgradeFailed = ko.pureComputed(
            () => !!upgradeStatus() && (
                upgradeStatus().state === 'FAILED' ||
                upgradeStatus().state === 'CANCELED'
            )
        );

        this.progressText = ko.pureComputed(
            () => step() === 'UPLOAD' ?
                `Uploading Package ${numeral(this.progress()).format('0%')}` :
                'Installing Package...'
        );
        
        this.supportEmail = support.email;
        this.supportEmailHref = `mailto:${support.email}`;
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
