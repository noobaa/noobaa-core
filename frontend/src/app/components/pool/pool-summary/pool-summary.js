import template from './pool-summary.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

class PoolSummaryViewModel {
	constructor({ pool }) {
		console.log(pool())
		this.gaugeLegend = ko.pureComputed(
			() => `${numeral(pool().total_nodes).format('0,0')} Nodes`
		);

		this.gaugeValues = ko.pureComputed(
			() => {
				let { used, free } = pool().storage;
				return [
					this._makeGaugeValue('Capacity Used', used, style['text-color6'], true),
					this._makeGaugeValue('Potential Capacity', free, style['text-color5'], true)
				]
			}
		);
	}

	_makeGaugeValue(label, value, color, emphasise) {
		return {
			label: `${label}: ${ formatSize(value) }`,
			value: value,
			color: color,
			emphasise: emphasise
		}
	}
}

export default {
	viewModel: PoolSummaryViewModel,
	template: template
}