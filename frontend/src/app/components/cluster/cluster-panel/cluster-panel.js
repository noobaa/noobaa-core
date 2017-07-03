/* Copyright (C) 2016 NooBaa */

import template from './cluster-panel.html';
import BaseViewModel from 'components/base-view-model';
import { routeContext } from 'model';

class ClusterPanelViewModel extends BaseViewModel {
    tabHref(tab) {
        return {
            route: 'cluster',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: (routeContext().params.tab  || 'servers') === tab
        };
    }
}

export default {
    viewModel: ClusterPanelViewModel,
    template: template
};
