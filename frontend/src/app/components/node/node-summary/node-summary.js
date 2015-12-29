import template from './node-summary.html';
import ko from 'knockout';
import moment from 'moment';
import { formatSize } from 'utils';
import style from 'style';

class NodeSummaryViewModel {
	constructor({ node }) {
		
		this.dataReady = ko.pureComputed(
			() => !!node()
		);

		this.ip = ko.pureComputed(
			() => node().ip
		);

		this.stateIcon = ko.pureComputed(
			() => `/assets/icons.svg#node-${node().online ? 'online' : 'offline'}`
		)

		this.state = ko.pureComputed(
			() => node().online ? 'Online' : 'Offline'
		);

		this.heartbeat = ko.pureComputed(
			() => moment(node().heartbeat).fromNow()
		);

		this.trustIcon = ko.pureComputed(
			() => `/assets/icons.svg#${node().trusted ? 'trusted' : 'untrusted'}`
		);

		this.trust = ko.pureComputed(
			() => node().trusted ? 'Trusted' : 'Untrusted'
		);

		this.gaugeLegend = ko.pureComputed(
			() => `Capacity (${formatSize(node().storage.total)})`
		);

		this.gaugeValues = ko.pureComputed(
			() => this._mapGaugeValues(node())
		);
	}


	_mapGaugeValues({ storage }) {
		let { total, used, free } = storage;
		let os = total - (used + free); 

		return [
			this._makeGaugeValue('NooBaa', used, style['text-color6'], true),
			this._makeGaugeValue('OS', os, style['text-color2'], false),
			this._makeGaugeValue('Unused', free, style['text-color5'], false)
		];		
	}

	_makeGaugeValue(label, value, color, emphasise) {
		return {
			label: `${label} (${ formatSize(value) })`,
			value: value,
			color: color,
			emphasise: emphasise
		}
	}		
}

export default {
	viewModel: NodeSummaryViewModel,
	template: template
}