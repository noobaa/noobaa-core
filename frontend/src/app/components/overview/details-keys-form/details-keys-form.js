import template from './details-keys-form.html';
import { systemOverview } from 'model';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils';

class BucketDetailsFormViewModel {
	constructor({ oncomplete }) {
		this.oncomplete = oncomplete;

		this.endpoint = ko.pureComputed(
			() => systemOverview().endpoint
		);

		this.accessKey = ko.pureComputed(
			() => systemOverview().keys.access
		);

		this.secretKey = ko.pureComputed(
			() => systemOverview().keys.secret
		);
	}

	copyToClipboard(data) {
		copyTextToClipboard(ko.unwrap(data));
	}

	close() {
		this.oncomplete();
	}
}

export default {
	viewModel: BucketDetailsFormViewModel,
	template: template
}