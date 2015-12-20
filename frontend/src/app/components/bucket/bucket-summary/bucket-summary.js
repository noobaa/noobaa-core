import template from './bucket-summary.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

class BucketSummrayViewModel {
	constructor({ bucket }) {
		this.fileCount = ko.pureComputed(
			() => bucket() ? bucket().num_objects : 0
		);

		this.qoutaUsed = ko.pureComputed(
			() => bucket() ? bucket().storage.total : 0
		);
		
		this.qoutaLimit = ko.pureComputed(
			() => bucket() ? bucket().storage.used : 0
		);

		this.areActionsVisible = ko.observable(false);

		this.isBucketPolicyModalVisible = ko.observable(false);
	}

	gagueLegend() {
		return `${numeral(this.fileCount()).format('0,0')} files`;
	}

	gagueValues() {
		return [
			{
				label: `Used: ${formatSize(this.qoutaUsed())}`,
				value: this.qoutaUsed(),
				color: style['text-color6'],
				emphasise: true
			},
			{
				label: `Total: ${formatSize(this.qoutaLimit())}`,
				value: this.qoutaLimit(),
				color: style['text-color5']
			}		
		];
	}

	toggleActions() {
		this.areActionsVisible(!this.areActionsVisible());
	}

	showBucketPolicyModal() {
		this.isBucketPolicyModalVisible(true);
	}

	hideBucketPolicyModal() {
		this.isBucketPolicyModalVisible(false);
	}
}

export default {
	viewModel: BucketSummrayViewModel,
	template: template
}