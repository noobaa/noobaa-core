import template from './object-summary.html';
import ko from 'knockout';

class ObjectSummaryViewModel {
	constructor({ object }) {
		this.s3Url = ko.pureComputed(
			() => object().s3Url
		);

		this.isPreviewModalVisible = ko.observable(false);
	}
}

export default {
	viewModel: ObjectSummaryViewModel,
	template: template
}