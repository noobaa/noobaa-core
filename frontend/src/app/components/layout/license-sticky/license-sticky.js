import template from './license-sticky.html';
import BaseViewModel from 'components/base-view-model';
import { systemInfo } from 'model';
import ko from 'knockout';
import { support } from 'config';

const teraByte = Math.pow(2, 40);

class LicenseStickyViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return false;
                }

                let { storage, system_cap } = systemInfo();
                return storage.used / teraByte > system_cap;
            }
        );

        this.capacityLimit = ko.pureComputed(
            () => systemInfo() && `${systemInfo().system_cap}TB`
        );

        this.upgradeEmailHref = ko.pureComputed(
            () => `mailto:${support.email}?subject=${support.upgradeToEnterpriseMailSubject}`
        );
    }
}

export default {
    viewModel: LicenseStickyViewModel,
    template: template
};
