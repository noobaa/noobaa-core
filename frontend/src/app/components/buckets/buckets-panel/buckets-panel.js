import template from './buckets-panel.html';
import ko from 'knockout';
import { bucketList } from 'model';

class BucketsPanelViewModal {
	constructor() {	
		this.buckets = bucketList;
		this.isCreateBucketModalVisible = ko.observable(false); 	 		
	}
}

export default {
	viewModel: BucketsPanelViewModal,
	template: template
}