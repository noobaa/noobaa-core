import ko from 'knockout';
import numeral from 'numeral';

const uploadStateIconMapping = {
	IN_PORCESS: '/assets/icons.svg#object-in-process',
	SUCCESS: '/assets/icons.svg#object-healthy',
	FAILED: '/assets/icons.svg#object-problem'
};

export default class UploadRowViewModel {
	constructor(upload) {
		this.isVisible =  ko.pureComputed(
			() => !!upload()
		);

		this.name = ko.pureComputed(
			() => upload().name 
		);

		this.stateIcon = ko.pureComputed(
			() => uploadStateIconMapping[upload().state]
		);

		this.css = ko.pureComputed(
			() => upload().state.toLowerCase()
		);

		this.progress = ko.pureComputed(
			() => upload().state !== 'FAILED' ? 
				numeral(upload().progress).format('0%') : 
				'FAILED'
		);
	}
}