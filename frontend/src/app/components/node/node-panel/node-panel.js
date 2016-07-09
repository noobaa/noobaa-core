import template from './node-panel.html';
import BaseViewModel from 'base-view-model';
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

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }

    isTabSelected(name) {
        return this.selectedTab() === name;
    }
}

export default {
    viewModel: NodePanelViewModel,
    template: template
};
