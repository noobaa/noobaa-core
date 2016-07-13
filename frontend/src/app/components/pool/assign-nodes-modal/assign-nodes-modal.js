import template from './assign-nodes-modal.html';
import NodeRowViewModel from './node-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { makeArray, noop } from 'utils';
import { nodeList } from 'model';
import { loadNodeList, assignNodes } from 'actions';

class AssignNodeModalViewModel extends Disposable {
    constructor({ poolName, onClose = noop }) {
        super();

        this.poolName = poolName;
        this.onClose = onClose;

        this.relevantNodes = ko.pureComputed(
            () => nodeList() && nodeList().filter(
                node => node.pool !== ko.unwrap(this.poolName)
            )
        );

        this.rows = makeArray(
            500,
            i => new NodeRowViewModel(() => this.relevantNodes()[i])
        );

        this.emptyMessage = ko.pureComputed(
            () => {
                if (nodeList() !== null) {
                    if (nodeList().length === 0) {
                        return 'The system contain no nodes';

                    } else if (this.relevantNodes().length === 0) {
                        return 'All nodes are already in this pool';
                    }
                }
            }
        );

        this.selectedNodes = ko.observableArray();

        // Need to load the pool list
        loadNodeList();
    }

    selectAllNodes() {
        this.selectedNodes(
            this.relevantNodes().map(
                node => node.name
            )
        );
    }

    clearAllNodes() {
        this.selectedNodes([]);
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
