import template from './overview-panel.html';

class OverviewPanelViewModel {
	constructor() {

		this.showAddNodeModal = false;
		this.showRestDetailsModal = false;

		// appState.subscribe(state => {
		// 	this.showAddNodeModal(state.modal === 'add-node');
		// 	this.showRestDetailsModal(state.modal === 'rest-details');
		// });
	}

	dispose() {
			// pubsub.unsubscribe(this.subscription);

	}

}

export default { 
	viewModel: OverviewPanelViewModel,
	template: template
}
