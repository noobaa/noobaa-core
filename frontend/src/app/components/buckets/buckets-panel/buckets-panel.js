import template from './buckets-panel.html';
import ko from 'knockout';
import { bucketList, routeContext } from 'model';
import { cmpStrings, cmpInts, cmpBools } from 'utils';

const cmpFuncs = Object.freeze({
	state: (b1, b2) => cmpBools(b1.state, b2.state),
	name: (b1, b2) => cmpStrings(b1.name, b2.name),
	filecount: (b1, b2) => cmpInts(b1.num_objects, b2.num_objects),
	totalsize: (b1, b2) => cmpInts(b1.storage.total, b2.storage.total),
	freesize: (b1, b2) => cmpInts(b1.storage.free, b2.storage.free),
	cloudsync: (b1, b2) => cmpStrings(b1.cloud_sync_status, b2.cloud_sync_status)
});

class BucketsPanelViewModal {
	constructor() {	
		let orderBy = ko.pureComputed(
			() => routeContext().query.orderBy || 'name'
		);

		let reverse = ko.pureComputed(
			() => routeContext().query.reverse
		);

		this.buckets = ko.pureComputed(() => {
			let cmpFunc = cmpFuncs[orderBy()];
			let buckets = bucketList().sort(cmpFunc);
			reverse() && buckets.reverse();
			return buckets;
		});

		this.buckets.orderedBy = orderBy;
		this.buckets.reversed = reverse;

		this.isCreateBucketModalVisible = ko.observable(false); 	 		
	}

	closeCreateBucketModal() {
		console.log('here', this);
		this.isCreateBucketModalVisible(false);
	}

	openCreateBucketModal() {
		this.isCreateBucketModalVisible(true);
	}
}

export default {
	viewModel: BucketsPanelViewModal,
	template: template
}