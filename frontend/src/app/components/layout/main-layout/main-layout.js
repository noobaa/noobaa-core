import template from './main-layout.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { redirectTo } from 'actions';
import { system as systemRoute } from 'routes';
import { uiState, systemInfo, routeContext } from 'model';

class MainLayoutViewModel extends Disposable {
    constructor() {
        super();

        this.panel = ko.pureComputed(
            () => `${uiState().panel}-panel`
        );

        this.showDebugOutline = ko.pureComputed(
            () => !!systemInfo() && systemInfo().debug_level > 0
        );

        this.isAfterUpgradeModalVisible = ko.pureComputed(
            () => !!routeContext().query.afterupgrade
        );

        this.isWelcomeModalVisible = ko.pureComputed(
            () => !!routeContext().query.welcome
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
