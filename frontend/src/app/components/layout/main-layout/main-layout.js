import template from './main-layout.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { redirectTo } from 'actions';
import { system as systemRoute } from 'routes';
import { uiState, systemInfo, routeContext } from 'model';
//import { deepFreeze } from 'utils';

class MainLayoutViewModel extends Disposable {
    constructor() {
        super();

        this.panel = ko.pureComputed(
            () => `${uiState().panel}-panel`
        );

        this.isAfterUpgradeModalVisible = ko.pureComputed(
            () => !!routeContext().query.afterupgrade
        );

        this.isWelcomeModalVisible = ko.pureComputed(
            () => !!routeContext().query.welcome
        );

        this.isUpgradedCapacityNofiticationModalVisible = ko.pureComputed(
            () => systemInfo() && systemInfo().phone_home_config.upgraded_cap_notification
        );
    }

    hideWelcomeModal() {
        redirectTo(systemRoute);
    }

    hideAfterUpgradeModal() {
        redirectTo(systemRoute);
    }

    hideUpgradedCapacityNofiticationModal() {
        console.warn('CLOSED');
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
