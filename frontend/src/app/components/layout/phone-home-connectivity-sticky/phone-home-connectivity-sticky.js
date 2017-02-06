import template from './phone-home-connectivity-sticky.html';
import BaseViewModel from 'components/base-view-model';
import { systemInfo } from 'model';
import ko from 'knockout';

class PhoneHomeConnectivityStickyViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => Boolean(
                systemInfo() &&
                systemInfo().phone_home_config.phone_home_unable_comm
            )
        );
    }
}

export default {
    viewModel: PhoneHomeConnectivityStickyViewModel,
    template: template
};
