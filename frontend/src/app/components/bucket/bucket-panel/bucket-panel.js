import template from './bucket-panel.html';
import ko from 'knockout';
import { throttle, stringifyQueryString } from 'utils';
import { uiState, bucketInfo, bucketObjectList } from 'model';

const inputThrottle = 400;

class BucketPanelViewModel {
	constructor() {
		this.bucket = bucketInfo;
		this.objects = bucketObjectList;
		this.objectFilter = ko.pureComputed({
			read: bucketObjectList.filter,
			write: throttle(this.filter, inputThrottle)
		});

		this.selectedTab = ko.pureComputed(
			() => uiState().tab
		);
	}

	filter(phrase) {
	 	let query = stringifyQueryString({ objFilter: phrase.trim() || undefined });
		window.location = `/systems/:system/buckets/:bucket/objects?${query}`;			
	}
}

export default {
	viewModel: BucketPanelViewModel,
	template: template
}