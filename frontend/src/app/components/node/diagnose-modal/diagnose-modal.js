import template from './diagnose-modal.html';
import ko from 'knockout';
import { startDebugCollection } from 'actions';

class DiagnoseModalViewModel {
	constructor({ nodeName, nodeRpcAddress, onClose }) {
		this.onClose = onClose;
		this.nodeName = nodeName;
		this.nodeRpcAddress = nodeRpcAddress;
		this.debugLevel = ko.observable('LOW');
	}

	close() {
		this.onClose();
	}

	start() {
		startDebugCollection(
			ko.unwrap(this.nodeName),
			ko.unwrap(this.nodeRpcAddress),
			this.debugLevel()
		);
		
		this.onClose();
	}
}

export default {
	viewModel: DiagnoseModalViewModel,
	template: template
}