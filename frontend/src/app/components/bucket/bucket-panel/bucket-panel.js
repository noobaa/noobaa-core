import template from './bucket-panel.html';
import ko from 'knockout';
import page from 'page';

// import { inputThrottle } from 'config';
// import { throttle, stringifyQueryString } from 'utils';
import { uiState, bucketInfo, bucketObjectList } from 'model';

class BucketPanelViewModel {
	constructor() {
		this.bucket = bucketInfo;
		this.objects = bucketObjectList;

		bucketInfo.subscribe(x => console.log(x))

		this.selectedTab = ko.pureComputed(
			() => uiState().tab
		);
	}

	isTabSelected(tabName) {
		return this.selectedTab() === tabName;
	}

	changeFilter(filter) {
		this._updateState(
			filter, 
			this.orderBy(), 
			this.reverse(),
			0
		);
	}

	sort(sortBy) {
		this._updateState(
			this.filter(),
			sortBy,
			false,
			this.page()
		);
	}

	reverseOrder(reversed) {
		this._updateState(
			this.filter(),
			this.sortBy(),
			reversed,
			this.page()
		)
	}

	pageBackword() {
		if (!this.hasPrevPage()) {
			return;
		}
			
		this._updateState(
			this.filter(), 
			this.orderBy(), 
			this.reverse(),
			this.page() - 1
		);
	}

	pageForword() {
		if (!this.hasNextPage()) {
			return;
		}
	
		this._updateState(
			this.filter(), 
			this.orderBy(), 
			this.page() + 1
		);
	}

	_updateState(filter, sortBy, reverse, pageNum) {
		let query = stringifyQueryString({ 
			filter: filter.trim() || undefined,
			sortBy: sortBy || undefined,
			reverse: reverse || undefined,
			pageNum: pageNum || undefined
		});

		page.show(`${window.location.pathname}/${query}`);
	}
}

export default {
	viewModel: BucketPanelViewModel,
	template: template
}