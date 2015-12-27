import { formatSize } from 'utils';
import ko from 'knockout';

const statusIconMapping = Object.freeze({
	AVALIABLE: '/assets/icons.svg#object-healthy',
	IN_PROCESS: '/assets/icons.svg#object-in-porcess',
	UNAVALIABLE: '/assets/icons.svg#object-problem'
});

export default class ObjectRowViewModel {
	constructor(obj) {
		this.isVisible = ko.pureComputed(
			() => !!obj()
		);

		this.name = ko.pureComputed(
			() => obj().key
		);

		this.stateIcon = ko.pureComputed(
			() => statusIconMapping[obj().info.state || 'AVALIABLE']
		);

		this.href = ko.pureComputed(
			() => `/systems/:system/buckets/:bucket/objects/${this.name()}`
		);

		this.size = ko.pureComputed(
			() => formatSize(obj().info.size)
		);
	}
}
