import template from './buckets-panel.html';
import ko from 'knockout';
import { bucketList, uiState } from 'model';

class BucketsPanelViewModal {
	constructor() {	
		this.buckets = bucketList;
		this.isCreateBucketModalVisible = ko.observable(false); 	 		
	}

	hideCreateBucketModal() {
		this.isCreateBucketModalVisible(false);
	}

	showCreateBucketModal() {
		this.isCreateBucketModalVisible(true);
	}
}

export default {
	viewModel: BucketsPanelViewModal,
	template: template
}