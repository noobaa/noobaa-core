/* Copyright (C) 2016 NooBaa */

import template from './management-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import * as routes from 'routes';
import { routeContext } from 'model';
import { navigateTo } from 'actions';

class ManagementPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.selectedTab = ko.pureComputed(
            () => routeContext().params.tab || 'accounts'
        );

        this.section = ko.pureComputed({
            read: () => routeContext().params.section,
            write: section => navigateTo(routes.management, { section })
        });
    }

    tabHref(tab) {
        return {
            route: 'management',
            params: { tab, section: null }
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
