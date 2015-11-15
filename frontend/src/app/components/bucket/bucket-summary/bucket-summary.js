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
			() => 0 // TODO: Get relevant info when avaliable
		);
		
		this.qoutaLimit = ko.pureComputed(
			() => 0 // TODO: Get relevant info when avaliable
		);
	}

	gagueLegend() {
		return `${numeral(this.fileCount()).format('0,0')} files`;
	}

	gagueValues() {
		return [
			{
				label: `Quota Used: ${formatSize(this.qoutaUsed())}`,
				value: this.qoutaUsed(),
				color: style['text-color6'],
				emphasise: true
			},
			{
				label: `Quota Limit: ${formatSize(this.qoutaLimit())}`,
				value: this.qoutaLimit(),
				color: style['text-color5']
			}		
		];
	}
}

export default {
	viewModel: BucketSummrayViewModel,
	template: template
}