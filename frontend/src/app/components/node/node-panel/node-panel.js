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
