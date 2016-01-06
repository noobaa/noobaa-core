import { formatSize } from 'utils';
import ko from 'knockout';

const statusIconMapping = Object.freeze({
	AVALIABLE: '/fe/assets/icons.svg#object-healthy',
	IN_PROCESS: '/fe/assets/icons.svg#object-in-porcess',
	UNAVALIABLE: '/fe/assets/icons.svg#object-problem'
});

export default class ObjectRowViewModel {
	constructor(obj) {
		this.isVisible = ko.pureComputed(
			() => !!obj()
		);

		this.name = ko.pureComputed(
			() => !!obj() && obj().key
		);

		this.stateIcon = ko.pureComputed(
			() => !!obj() && statusIconMapping[obj().info.state || 'AVALIABLE']
		);

		this.href = ko.pureComputed(
			() => `/fe/systems/:system/buckets/:bucket/objects/${this.name()}`
		);

		this.size = ko.pureComputed(
			() => !!obj() && formatSize(obj().info.size)
		);
	}
}
