import template from './buckets-panel.html';
import { uiState } from 'model';

class BucketPanelViewModel {
    tabHref(tab) {
        return {
            route: 'buckets',
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
    viewModel: BucketPanelViewModel,
    template: template
};
