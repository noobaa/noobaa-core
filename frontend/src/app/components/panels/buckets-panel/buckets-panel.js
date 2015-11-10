import template from './buckets-panel.html';
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import rx from 'rxjs';
import api from 'services/api';
import { createCompareFunc } from 'utils';
import { appState, systemInfo } from 'shared-streams';
import { readSystemInfo, deleteBucket } from 'actions';

const orderOps = Object.freeze({
	state: 	createCompareFunc(b => b.state),
	name: createCompareFunc(b => b.name),
	filecount: createCompareFunc(b => b.num_objects),
	totalsize: createCompareFunc(b => b.storage.total),
	freesize: createCompareFunc(b => b.storage.free),
	cloudsyncstatus: createCompareFunc(b => b.cloud_sync_status)
});

class BucketsPanelViewModal {
	constructor() {	
		// Refresh the data in the system info.
		readSystemInfo();
		
		let buckets = systemInfo.pluck('buckets').toKO([]);
		this.orderBy = appState.pluck('params', 'orderby').toKO();

		this.orderedBuckets = ko.pureComputed(() => {
			return buckets()
				.sort(orderOps[this.orderBy()])
				.map(bucket => new BucketRowViewModel(bucket));
		});

		this.deleteCandidate = ko.observable();

		this.showCreateBucketModal = appState
			.pluck('hash', 'create-bucket')
			.toKO();
	}

	getColumnCss(name) {
		return { ordered: this.orderBy() === name.toLowerCase() };
	}

	getColumnHref(name) {
		return `orderby=${name.toLowerCase()}`;
	}

	isDeleteCandidate(bucketName) {
		return bucketName === this.deleteCandidate();
	}

	confirmDelete() {
		deleteBucket(this.deleteCandidate());
	}

	cancelDelete() {
		this.deleteCandidate(null);
	}
}


class BucketsPanelViewModel2 {
	constructor() {
		this.orderBy = ko.pureComputed( () => appState().params['orderby'] || 'name' );
		
		this.reverseOrder = ko.pureComputed( () => !!appState().params['revreseorder'] );
		
		this.showCreateBucketModal = ko.pureComputed( () => appState().hash === 'create-bucket');		
		
		this.deleteCanidate = ko.observable();		

		this.buckets = ko.computed( () => {
			let buckets = systemInfo().buckets
				.sort(sortOps[this.orderBy()])

			if (reverseOrder()) {
				buckets = buckets.reverse();
			}

			return buckets;
		});
	}
}

export default {
	viewModel: BucketsPanelViewModal,
	template: template
}