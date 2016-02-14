import template from './node-panel.html';
import ko from 'knockout';
import { uiState, nodeInfo, nodeStoredPartList } from 'model';

class NodePanelViewModel {
    constructor() {
        this.node = nodeInfo;
        this.storedParts = nodeStoredPartList;

        this.ready = ko.pureComputed(
            () => !!this.node()
        );        

        this.selectedTab = ko.pureComputed(
            () => uiState().tab
        );
    }
}

export default {
    viewModel: NodePanelViewModel,
    template: template 
}