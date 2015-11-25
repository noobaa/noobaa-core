import template from './create-bucket-form.html';
import ko from 'knockout';
import { createBucket } from 'actions';

const bucketNamePattern = '^[a-z0-9](-|[a-z0-9]){2,62}$';
const sizeUnits = [ 
	{ label: 'GB', value: 3 },
	{ label: 'TB', value: 4 },
	{ label: 'PB', value: 5 },
];

class CreateBucketFormViewModel {
	constructor() {
		this.bucketName = ko.observable().extend({
			required: true,
			pattern: bucketNamePattern
		});

		this.limitQuota = ko.observable(true);
		this.quotaValue = ko.observable(1);
		this.quotaUnit = ko.observable(sizeUnits[0]);
		this.sizeUnits = sizeUnits;
		
		// The actual qouta in bytes.
		this.quota = ko.pureComputed(() => {
			return this.limitQuota() ? 
				this.quotaValue() * 1024 ** this.quotaUnit().value :
				-1;
		});

		// Validation error group.
		this.errors = ko.validation.group(this);
	}

	create() {
		if (this.errors().length === 0) {
			// Initiate a create bucket request.
			createBucket({
				name: this.bucketName(),
				quota: this.quota()
			});

			history.back();			
		} else {
			this.errors.showAllMessages();
		}
	}

	cancel() {
		router.back();
	}
}

export default {
	viewModel: CreateBucketFormViewModel,
	template: template
};