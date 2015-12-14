import template from './bucket-policy-form.html';
import ko from 'knockout';

class BucketPolicyFormViewModel {
	constructor() {
		this.bucketName = "My Bucket";

		this.pools = [
			{ name: 'Sony building', selected: ko.observable(true) },
			{ name: 'TwinTower-Dubai', selected: ko.observable(true) },
			{ name: 'AmsterdamP-Leiden', selected: ko.observable(true) },
			{ name: 'NY-Pool', selected: ko.observable(true) },
			{ name: 'Meriland', selected: ko.observable(true) },
			{ name: 'Campus', selected: ko.observable(true) },
			{ name: 'Chicago', selected: ko.observable(true) },
			{ name: 'Chicago-02', selected: ko.observable(true) },
			{ name: 'Another Chicago', selected: ko.observable(true) },
			{ name: 'San Francisco', selected: ko.observable(true) },
			{ name: 'Beijing_centeral',		 selected: ko.observable(true) },
			{ name: 'Seol-Station', selected: ko.observable(true) },
			{ name: 'Memphis', selected: ko.observable(true) },
			{ name: 'Osaka-Servers', selected: ko.observable(true)},
			{ name: 'Osaka-Desktops', selected: ko.observable(true) }
		];
	}

	selectAll() {
		this.pools.forEach(
			pool => pool.selected(true)
		);
	}

	clearAll() {
		this.pools.forEach(
			pool => pool.selected(false)
		);
	}

	save() {

	}

	cancel() {

	}
}

export default {
	viewModel: BucketPolicyFormViewModel,
	template: template
}