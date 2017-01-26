import template from './main-layout.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { redirectTo } from 'actions';
import { system as systemRoute } from 'routes';
import { uiState, systemInfo, routeContext } from 'model';

class MainLayoutViewModel extends BaseViewModel {
    constructor() {
        super();

        this.panel = ko.pureComputed(
            () => `${uiState().panel}-panel`
        );

        this.useBackground = ko.pureComputed(
            () => Boolean(uiState().useBackground)
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
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
