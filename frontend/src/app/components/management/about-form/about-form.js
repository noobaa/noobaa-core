import template from './about-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { upgradeSystem } from 'actions';
import { upgradePackageSuffix } from 'config';

class AboutFormViewModel {
    constructor() {
        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version
        );

        this.upgradePackageSuffix = upgradePackageSuffix;

        this.isUpgradingModalVisible = ko.observable(false);
    }

    upgrade(upgradePackage) {
        this.isUpgradingModalVisible(true);
        upgradeSystem(upgradePackage);
    }
}

export default {
    viewModel: AboutFormViewModel,
    template: template
};
