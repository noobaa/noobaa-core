/* Copyright (C) 2016 NooBaa */

import template from './overview-panel.html';
import BaseViewModel from 'components/base-view-model';

class OverviewPanelViewModel extends BaseViewModel {
    constructor() {
        super();
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
