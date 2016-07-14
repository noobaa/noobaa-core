import template from './assign-nodes-modal.html';
import NodeRowViewModel from './node-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop, throttle } from 'utils';
import { systemInfo, nodeList } from 'model';
import { loadNodeList, assignNodes } from 'actions';
import { inputThrottle } from 'config';

const columns = [
    {
        name: 'selected',
        label: '',
        cellTemplate: 'checkbox'
    },
    {
        name: 'state',
        cellTemplate: 'icon'
    },
    'name',
    'ip',
    'capacity',
    'pool',
    'recomended'
];

class AssignNodeModalViewModel extends Disposable {
    constructor({ poolName, onClose = noop }) {
        super();

        this.poolName = poolName;
        this.onClose = onClose;
        this.columns = columns;
        this.nodes = nodeList;

        this.nodeNames = ko.pureComputed(
            () => this.nodes() && this.nodes().map(
                node => node.name
            )
        );

        let _nameOrIpFilter = ko.observable();
        this.nameOrIpFilter = ko.pureComputed({
            read: _nameOrIpFilter,
            write: throttle(val => _nameOrIpFilter(val) && this.loadNodes(), inputThrottle)
        });

        let relevantPools = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.filter(
                pool => pool.name !== poolName()
            )
        );

        let relevantPoolNames = ko.pureComputed(
            () => relevantPools() && relevantPools().map(
                pool => pool.name
            )
        );

        this.poolFilterOptions = ko.pureComputed(
            () => [].concat(
                { label: 'All pools', value: relevantPoolNames() },
                relevantPoolNames().map(
                    name => ({ label: name, value: [name] })
                )
            )
        );

        let _poolFilter = ko.observableWithDefault(relevantPoolNames);
        this.poolFilter = ko.pureComputed({
            read: _poolFilter,
            write: val => _poolFilter(val) && this.loadNodes()
        });

        let _onlineFilter = ko.observable(true);
        this.onlineFilter = ko.pureComputed({
            read: _onlineFilter,
            write: val => _onlineFilter(val) && this.loadNodes()
        });

        this.selectedNodes = ko.observableArray();

        this.selectedMessage = ko.pureComputed(
            () => {
                let selectedCount = this.selectedNodes().length;
                let totalCount = relevantPools().reduce(
                    (sum ,pool) => sum + pool.nodes.count,
                    0
                );

                return `${selectedCount} nodes selected out of ${totalCount}`;
            }
        );

        let isFiltered = ko.pureComputed(
            () => this.nameOrIpFilter() ||
                this.onlineFilter() ||
                this.poolFilter() !== relevantPoolNames()
        );

        this.emptyMessage = ko.pureComputed(
            () => {
                if (!systemInfo() || !nodeList() || nodeList().length > 0) {
                    return;

                } else if (systemInfo().nodes.count === 0) {
                    return 'The system contain no nodes';

                } else if (isFiltered()) {
                    return 'The current filter does not match any node';

                } else if (this.nodes().length === 0) {
                    return 'All nodes are already in this pool';
                }
            }
        );

        // Need to load the pool list
        this.loadNodes();
    }

    loadNodes() {
        loadNodeList(
            this.nameOrIpFilter(),
            this.poolFilter(),
            this.onlineFilter() || undefined
        );
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

    rowFactory(node) {
        return new NodeRowViewModel(node, this.poolName, this.selectedNodes);
    }

    assign() {
        assignNodes(ko.unwrap(this.poolName), this.selectedNodes());
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AssignNodeModalViewModel,
    template: template
};
