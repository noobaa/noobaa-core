import template from './node-summary.html';
import ko from 'knockout';
import moment from 'moment';
import { startDebugCollection, downloadDiagnosticPack } from 'actions';
import { formatSize } from 'utils';
import style from 'style';

class NodeSummaryViewModel {
	constructor({ node }) {
		
		this.dataReady = ko.pureComputed(
			() => !!node()
		);

		this.name = ko.pureComputed(
			() => node().name
		);

		this.ip = ko.pureComputed(
			() => node().ip
		);

		this.stateIcon = ko.pureComputed(
			() => `/fe/assets/icons.svg#node-${node().online ? 'online' : 'offline'}`
		)

		this.state = ko.pureComputed(
			() => node().online ? 'Online' : 'Offline'
		);

		this.heartbeat = ko.pureComputed(
			() => moment(node().heartbeat).fromNow()
		);

		this.trustIcon = ko.pureComputed(
			() => `/fe/assets/icons.svg#${node().trusted ? 'trusted' : 'untrusted'}`
		);

		this.trust = ko.pureComputed(
			() => node().trusted ? 'Trusted' : 'Untrusted'
		);

		this.total = ko.pureComputed(
			() => node().storage.total
		);

		this.totalText = ko.pureComputed(
			() => formatSize(this.total())
		);		

		this.used = ko.pureComputed(
			() => node().storage.used
		);

		this.usedText = ko.pureComputed(
			() => formatSize(this.used())
		);		

		this.free = ko.pureComputed(
			() => node().storage.free
		);		

		this.freeText = ko.pureComputed(
			() => formatSize(this.free())
		);

		this.os = ko.pureComputed(
			() => this.total() - (this.used() + this.free())
		);		

		this.osText = ko.pureComputed(
			() => formatSize(this.os())
		);		

		this.gaugeValues = [
			{ value: this.used, color: style['text-color6'], emphasize: true },
			{ value: this.os, color: style['text-color2'] },
			{ value: this.free, color: style['text-color5'] }
		]

		this.rpcAddress = ko.pureComputed(
			() => !!node() && node().rpc_address
		);

		this.isTestModalVisible = ko.observable(false);
	}

	diagnose() {
		startDebugCollection(
			this.name(), 
			relaizeUri('/fe/system/:system/pools/:pool/nodes/:node')
		);
	}

	downloadDiagnosticPack() {
		downloadDiagnosticPack(this.name());
	}
}

export default {
	viewModel: NodeSummaryViewModel,
	template: template
}