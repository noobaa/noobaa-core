import template from './cluster-panel.html';
import BaseViewModel from 'base-view-model';
import { uiState } from 'model';

class ClusterPanelViewModel extends BaseViewModel {
    tabHref(tab) {
        return {
            route: 'cluster',
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
    viewModel: ClusterPanelViewModel,
    template: template
};
