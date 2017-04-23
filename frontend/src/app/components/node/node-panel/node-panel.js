/* Copyright (C) 2016 NooBaa */

import template from './node-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { uiState, nodeInfo, nodeStoredPartList } from 'model';

class NodePanelViewModel extends BaseViewModel {
    constructor() {
        super();

        this.node = nodeInfo;
        this.storedParts = nodeStoredPartList;

        this.ready = ko.pureComputed(
            () => !!this.node()
        );
    }

    tabHref(tab) {
        return {
            route: 'node',
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
    viewModel: NodePanelViewModel,
    template: template
};
