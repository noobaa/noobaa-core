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
			() => this._mapStateIcon(node())
		)

		this.stateText = ko.pureComputed(
			() => this._mapStateText(node())
		);

		this.trustIcon = ko.pureComputed(
			() => this._mapTrustIcon(node())
		);

		this.trustText = ko.pureComputed(
			() => this._mapTrustText(node())
		);

		this.gaugeLegend = ko.pureComputed(
			() => this._mapGaugeLegend(node())
		);

		this.gaugeValues = ko.pureComputed(
			() => this._mapGaugeValues(node())
		);
	}

	_mapStateIcon({ online }) {
		return `/assets/icons.svg#node-${online ? 'online' : 'offline'}`;
	}

	_mapStateText({ online, heartbeat }) {
		let stateText = online ? 'Online' : 'Offline';
		let formattedTime = moment(heartbeat).fromNow();

		return `${stateText} (Last heartbeat: ${formattedTime})`;		
	}

	_mapTrustIcon({ trusted }) {
		return `/assets/icons.svg#${trusted ? 'trusted' : 'untrusted'}`;
	}

	_mapTrustText({ trusted }) {
		return trusted ? 'Trusted' : 'Untrusted';	
	}

	_mapGaugeLegend({ storage }) {
		return `Capacity (${formatSize(storage.total)})`;
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