import template from './node-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { uiState, nodeInfo, nodeStoredPartList } from 'model';

class NodePanelViewModel extends Disposable {
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
