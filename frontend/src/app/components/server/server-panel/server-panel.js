/* Copyright (C) 2016 NooBaa */

import template from './server-panel.html';
import BaseViewModel from 'components/base-view-model';
import { routeContext } from 'model';
import { lastSegment } from 'utils/string-utils';
import ko from 'knockout';

class ServerPanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.serverSecret = ko.pureComputed(
            () => lastSegment(routeContext().params.server, '-')
        );
    }

    tabHref(tab) {
        return {
            route: 'server',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: (routeContext().params.tab || 'details') === tab
        };
    }
}

export default {
    viewModel: ServerPanelViewModel,
    template: template
};
