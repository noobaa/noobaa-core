import ko from 'knockout';
import numeral from 'numeral';

const partStateIconMapping = Object.freeze({
	available: 	'/assets/icons.svg#part-available',
	in_process: '/assets/icons.svg#part-in-process',
	unavailable:'/assets/icons.svg#part-unavailable' 
});

export default class ObjectRowViewModel {
	constructor(part) {
		this.isVisible = ko.pureComputed(
			() => !!part()
		);

		this.stateIcon = ko.pureComputed(
			() => partStateIconMapping[part().state] 
		);

		this.name = ko.pureComputed(
			() => part().object
		);

		this.href = ko.pureComputed(
			() => `/systems/:system/buckets/${part().bucket}/objects/${part().object}`
		);

		this.startOffset = ko.pureComputed(
			() => numeral(part().start).format('0.0b')
		);

		this.endOffset = ko.pureComputed(
			() => numeral(part().end).format('0.0b')
		);

		this.size = ko.pureComputed(
			() => numeral(part().size).format('0.0b')
		)
	}
}