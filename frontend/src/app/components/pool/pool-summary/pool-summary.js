import template from './pool-summary.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

class PoolSummaryViewModel {
	constructor({ pool }) {
		this.dataReady = ko.pureComputed(
			() => !!pool()
		);

		this.onlineCount = ko.pureComputed(
			() => {
				let count = pool().nodes.online;
				return `${count > 0 ? numeral(count).format('0,0') : 'No'} Online Nodes`;
			}
		);

		this.offlineCount = ko.pureComputed(
			() => {
				let count = pool().nodes.count - pool().nodes.online;
				return `${count > 0 ? numeral(count).format('0,0') : 'No'} Offline Nodes`;
			}
		);

		this.total = ko.pureComputed(
			() => pool().storage.total
		);

		this.totalText = ko.pureComputed(
			() => formatSize(this.total())
		);		

		this.used = ko.pureComputed(
			() => pool().storage.used
		);

		this.usedText = ko.pureComputed(
			() => formatSize(this.used())
		);		

		this.free = ko.pureComputed(
			() => pool().storage.free
		);		

		this.freeText = ko.pureComputed(
			() => formatSize(this.free())
		);		

		this.gaugeValues = [
			{ value: this.used, color: style['text-color6'], emphasize: true },
			{ value: this.free, color: style['text-color4'], emphasize: false },
		];
	}
}

export default {
	viewModel: PoolSummaryViewModel,
	template: template
}