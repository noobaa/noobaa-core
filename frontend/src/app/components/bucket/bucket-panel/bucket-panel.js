import template from './bucket-panel.html';
import ko from 'knockout';
import { bucketInfo, objectList } from 'stores';

class BucketPanelViewModel {
	constructor() {
		this.bucket = bucketInfo;
		this.objects = objectList;
		this.selectedTab = ko.observable('files');		
	}

}

export default {
	viewModel: BucketPanelViewModel,
	template: template
}