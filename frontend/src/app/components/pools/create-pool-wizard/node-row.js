import ko from 'knockout';
import { formatSize } from 'utils';

export default class NodeRowViewModel {
	constructor(node) {
		this.isVisible = ko.pureComputed(
			() => !!node()
		);

		this.name = ko.pureComputed(
			() => node().name
		);

		this.ip = ko.pureComputed(
			() => node().ip
		);

		this.capacity = ko.pureComputed(
			() => formatSize(node().storage.total)
		);
	}
}