import ko from 'knockout';
import numeral from 'numeral';

const partStateIconMapping = Object.freeze({
	available: 	'/assets/icons.svg#part-available',
	in_process: '/assets/icons.svg#part-in-process',
	unavailable:'/assets/icons.svg#part-unavailable' 
});

export default class PartRowViewModel {
	constructor(objectName, partInfo) {
		this.stateIcon = ko.observable(
			partStateIconMapping[partInfo.chunk.adminfo.health]
		);

		this.objectName = ko.observable(objectName);
		this.objectUrl = ko.observable(`/demo/buckets/${objectName}`);
		this.startOffset = ko.observable(numeral(partInfo.start).format('0.0b'));
		this.endOffset = ko.observable(numeral(partInfo.end).format('0.0b'));
		this.size = ko.observable(numeral(partInfo.chunk.size).format('0.0b'));
	}
}