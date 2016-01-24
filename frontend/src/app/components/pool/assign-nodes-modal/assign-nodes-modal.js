import template from './assign-nodes-modal.html';
import NodeRowViewModel from './node-row';
import ko from 'knockout';
import { makeArray } from 'utils';
import { nodeList } from 'model';
import { loadNodeList, assignNodes } from 'actions';

class AssignNodeModalViewModel {
	constructor({ poolName, onClose = noop }) {
		this.poolName = poolName;
		this.onClose = onClose;

		let nodes = nodeList.filter(
			node => node.pool !== ko.unwrap(this.poolName)
		);

		this.rows = makeArray(
			500, 
			i => new NodeRowViewModel(() => nodes()[i])
		);

		this.selectedNodes = ko.observableArray();

		// Need to load the pool list
		loadNodeList();
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
}