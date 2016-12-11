import template from './server-panel.html';
import Disposable from 'disposable';
import { uiState } from 'model';

class ServerPanelViewModel extends Disposable{
    constructor() {
        super();
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
