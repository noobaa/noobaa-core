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

    tabHref(tab) {
        return {
            route: 'management',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: this.selectedTab() === tab
        };
    }

    isSectionCollapsed(section) {
        return ko.pureComputed({
            read: () => this.section() !== section,
            write: val => this.section(val ? null : section)
        });
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
