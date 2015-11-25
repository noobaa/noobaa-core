import template from './buckets-panel.html';
import ko from 'knockout';
import { bucketList } from 'model';

class BucketsPanelViewModal {
	constructor() {	
		this.buckets = bucketList;
		this.showCreateBucketModal = ko.observable(false); 	 		
	}

	openCreateBucketModal() {
		this.showCreateBucketModal(true);
	}
}
export default {
	viewModel: BucketsPanelViewModal,
	template: template
}