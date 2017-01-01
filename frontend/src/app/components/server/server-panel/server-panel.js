import template from './server-panel.html';
import BaseViewModel from 'base-view-model';
import { routeContext, uiState } from 'model';
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
            selected: uiState().tab === tab
        };
    }
}

export default {
    viewModel: ServerPanelViewModel,
    template: template
};
