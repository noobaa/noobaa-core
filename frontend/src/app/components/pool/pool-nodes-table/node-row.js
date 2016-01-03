import ko from 'knockout';
import { formatSize } from 'utils';

export default class NodeRowViewModel {
	constructor(node) {
		this.isVisible = ko.pureComputed(
			() => !!node()
		);

		this.stateIcon = ko.pureComputed(
			() => `/fe/assets/icons.svg#node-${node().online ? 'online' : 'offline'}`
		);

		this.name = ko.pureComputed(
			() => node().name
		);

		this.href = ko.pureComputed(
			() => `/fe/systems/:system/pools/:pool/nodes/${node().name}`
		);

		this.ip = ko.pureComputed(
			() => node().ip
		);

		this.capacity = ko.pureComputed(
			() => node().storage ? formatSize(node().storage.total) : 'N/A'
		);		
	}
}