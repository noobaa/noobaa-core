import template from './node-summary.html';
import ko from 'knockout';
import { node } from 'services/api';
import moment from 'moment';
import { formatSize } from 'utils';
import style from 'style';

const nodeName = 'nb-ohad-server-6e43a1f0-dcb1-4c9e-85d9-db45a151ca11';

class NodeSummaryViewModel {
	constructor() {
		this.ip = ko.observable('0.0.0.0');
		this.totalSize = ko.observable(0);
		this.nbSize = ko.observable(0);
		this.freeSize = ko.observable(0);
		this.isTrusted = ko.observable(false);
		this.isOnline = ko.observable(false)
		this.lastHeartbeat = ko.observable(0);
		this.selectedTab = ko.observable('file-parts');

		node.read_node({ name: nodeName })
			.then(node => this._mapData(node))
			.done();
	}

	gaugeLagend() {
		return `Capacity (${formatSize(this.totalSize())})`;
	}

	gaugeValues() {
		return [
			this._makeGaugeValue('NooBaa', this.nbSize(), style['text-color6'], true),
			this._makeGaugeValue('OS', this.osSize(), style['text-color2'], false),
			this._makeGaugeValue('Unused', this.freeSize(), style['text-color5'], false)
		];		
	}

	osSize() {
		return this.totalSize() - (this.nbSize() + this.freeSize());
	}	

	statusIcon() {
		return `/assets/icons.svg#node-${this.isOnline() ? 'online' : 'offline'}`;
	}

	statusText() {
		let statusText = this.isOnline() ? 'Online' : 'Offline';
		let formattedTime = moment(this.lastHeartbeat()).fromNow();

		return `${statusText} (Last heartbeat: ${formattedTime})`		
	}

	trustIcon() {
		return `/assets/icons.svg#${this.isTrusted() ? 'trusted' : 'untrusted'}`;
	}

	trustText() {
		return this.isTrusted() ? 'Trusted' : 'Untrusted';	
	}

	_makeGaugeValue(label, value, color, emphasise) {
		return {
			label: `${label} (${ formatSize(value) })`,
			value: value,
			color: color,
			emphasise: emphasise
		}
	}		

	_mapData(node) {
		let { storage } = node;

		this.ip(node.ip);
		this.totalSize(storage.total);
		this.freeSize(storage.free);
		this.nbSize(storage.used);
		this.isTrusted(node.trusted);
		this.isOnline(node.online);
		this.lastHeartbeat(node.heartbeat);
	}
}

export default {
	viewModel: NodeSummaryViewModel,
	template: template
}