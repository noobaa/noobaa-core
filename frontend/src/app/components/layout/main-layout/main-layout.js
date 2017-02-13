import template from './main-layout.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { registerForAlerts } from 'actions';
import { uiState, systemInfo, routeContext } from 'model';
import { openAfterUpgradeModal, openWelcomeModal,
    openUpgradedCapacityNofiticationModal } from 'dispatchers';

class MainLayoutViewModel extends BaseViewModel {
    constructor() {
        super();

        this.panel = ko.pureComputed(
            () => `${uiState().panel}-panel`
        );

        this.useBackground = ko.pureComputed(
            () => Boolean(uiState().useBackground)
        );

        const query = ko.pureComputed(
            () => routeContext().query
        );

        // Handle after upgrade modal.
        this.addToDisposeList(
            ko.computed(
                () => query().afterupgrade && openAfterUpgradeModal()
            )
        );

        // Handle welcome modal.
        this.addToDisposeList(
            ko.computed(
                () => query().welcome && openWelcomeModal()
            )
        );

        // Handle upgraded capacity nofitication modal
        const upgradedCapNotification = ko.pureComputed(
            () => Boolean(
                systemInfo() &&
                systemInfo().phone_home_config.upgraded_cap_notification
            )
        );
        this.addToDisposeList(
            ko.computed(
                () => upgradedCapNotification() &&
                    openUpgradedCapacityNofiticationModal()
            )
        );

        registerForAlerts();
    }
}

export default {
    viewModel: MainLayoutViewModel,
    template: template
};
