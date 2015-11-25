import template from './buckets-panel.html';
import { bucketList } from 'model';

class BucketsPanelViewModal {
	constructor() {	
		this.buckets = bucketList;
		this.showCreateBucketModal = false; 	 		
	}
}
export default {
	viewModel: BucketsPanelViewModal,
	template: template
}