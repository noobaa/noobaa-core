import template from './node-selection-table.html';
import Disposable from 'disposable';
import NodeRowViewModel from './node-row';
import { deepFreeze } from 'utils/all';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon'
    },
    'name',
    {
        name: 'ip',
        label: 'IP'
    },
    'capacity',
    'pool',
    'recommended'
]);

class NodeSelectionTableViewModel extends Disposable{
    constructor({
        caption = 'Select Nodes',
        nodes = [],
        selectedNodes = ko.observableArray(),
        nodeCount = ko.pureComputed(() => ko.unwrap(nodes).length),
        poolName,
        emptyMessage = ''
    }) {
        super();

        this.columns = columns;
        this.caption = caption;
        this.nodes = nodes;
        this.selectedNodes = selectedNodes;
        this.poolName = poolName;
        this.emptyMessage = emptyMessage;

        this.nodeNames = ko.pureComputed(
            () => (ko.unwrap(nodes) || []).map(
                node => node.name
            )
        );

        this.selectedMessage = ko.pureComputed(
            () => {
                let selectedCount = this.selectedNodes().length;
                return `${selectedCount} nodes selected of ${nodeCount()}`;
            }
        );
    }

    createRow(node) {
        return new NodeRowViewModel(node, this.selectedNodes, this.poolName);
    }

    selectListedNodes() {
        let nodes = this.nodeNames().filter(
            node => !this.selectedNodes().includes(node)
        );

        this.selectedNodes(
            this.selectedNodes().concat(nodes)
        );
    }

    clearListedNodes() {
        this.selectedNodes.removeAll(
            this.nodeNames()
        );
    }

    clearAllNodes() {
        this.selectedNodes([]);
    }
}

export default {
    viewModel: NodeSelectionTableViewModel,
    template: template
};
