import numeral from 'numeral';

const partStateIconMapping = Object.freeze({
	available: 	'/assets/icons.svg#part-available',
	in_process: '/assets/icons.svg#part-in-process',
	unavailable:'/assets/icons.svg#part-unavailable' 
});

export default class ObjectRowViewModel {
	constructor(objectName, bucketName, partInfo) {
		this.stateIcon = partStateIconMapping[partInfo.chunk.adminfo.health];
		this.objectName = objectName;
		this.objectUrl = `/systems/:system/buckets/${bucketName}/objects/${objectName}`;
		this.startOffset = numeral(partInfo.start).format('0.0b');
		this.endOffset = numeral(partInfo.end).format('0.0b');
		this.size = numeral(partInfo.chunk.size).format('0.0b');
	}
}