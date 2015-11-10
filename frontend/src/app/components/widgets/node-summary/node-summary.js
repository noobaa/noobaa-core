import template from './node-summary.html';
import ko from 'knockout';
import api from 'services/api';
import moment from 'moment';
import { formatSize } from 'utils';

const nodeName = 'Nimrods-MacBook-Air.local-fe61d7e7-6b66-4e6c-aa69-ace800fca61f';

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

		api.read_node({ name: nodeName })
			.then(node => this._mapData(node));
	}

	gaugeLagend() {
		return `Capacity (${formatSize(this.totalSize())})`;
	}

	gaugeValues() {
		return [
			this._makeGaugeValue('NooBaa', this.nbSize(), '#3494D9', true),
			this._makeGaugeValue('OS', this.osSize(), '#C3CEEF', false),
			this._makeGaugeValue('Unused', this.freeSize(), '#35434E', false)
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