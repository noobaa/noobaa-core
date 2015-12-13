import template from './bucket-objects-tab.html';

class BucketObjectsTabViewModel {
	constructor({ objects }) {
		this.objects = objects;
	}
}

export default {
	viewModel: BucketObjectsTabViewModel,
	template: template,
}