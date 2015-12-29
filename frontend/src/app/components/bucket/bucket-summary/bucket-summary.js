import template from './bucket-summary.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

class BucketSummrayViewModel {
	constructor({ bucket }) {
		this.name  = ko.pureComputed(
			() => bucket() ? bucket().name : null
		);

		this.fileCount = ko.pureComputed(
			() => bucket() ? bucket().num_objects : 0
		);

		this.used = ko.pureComputed(
			() => bucket() ? bucket().storage.total : 0
		);
		
		this.total = ko.pureComputed(
			() => bucket() ? bucket().storage.used : 0
		);

		this.policy = ko.pureComputed(
			() => bucket() ? bucket().tiering[0].name : null
		);

		this.areActionsVisible = ko.observable(false);
		this.isPolicyModalVisible = ko.observable(false);
		this.isUploadFilesModalVisible = ko.observable(false);
		this.isCloudSyncModalVisible = ko.observable(false);

		this.gauge = {
			legend: `${this.fileCount() ? numeral(this.fileCount()).format('0,0') : 'No'} files`,
			total: {
				label: `Total: ${formatSize(this.total())}`,
				value: this.total(),
				color: style['text-color5']
			},
			values: [
				{
					label: `Used: ${formatSize(this.used())}`,
					value: this.used(),
					color: style['text-color6'],
					emphasise: true
				}
			]
		};
	}

	gagueLegend() {
		let count = this.fileCount();
		return `${count ? numeral(count).format('0,0') : 'No'} files`;
	}

	gagueValues() {
		return [
			{
				label: `Used: ${formatSize(this.used())}`,
				value: this.used(),
				color: style['text-color6'],
				emphasise: true
			},
			{
				label: `Total: ${formatSize(this.total())}`,
				value: this.total() || 1,
				color: style['text-color5']
			}		
		];
	}

	toggleActions() {
		this.areActionsVisible(!this.areActionsVisible());
	}
}

export default {
	viewModel: BucketSummrayViewModel,
	template: template
}