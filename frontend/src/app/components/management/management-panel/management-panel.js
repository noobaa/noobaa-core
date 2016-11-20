import template from './management-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import * as routes from 'routes';
import { uiState, routeContext } from 'model';
import { navigateTo } from 'actions';

class ManagementPanelViewModel extends Disposable {
    constructor() {
        super();

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );

        this.section = ko.pureComputed({
            read: () => routeContext().params.section,
            write: section => navigateTo(routes.management, { section })
        });
    }

    isSectionSelected(section) {
        return ko.pureComputed({
            read: () => this.section() !== section,
            write: val => this.section(val ? null : section)
        });
    }

    isTabSelected(tab) {
        return this.selectedTab() === tab;
    }

    generateTabUrl(tab) {
        return {
            route: 'management',
            params: { tab: tab, section: null }
        };
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
