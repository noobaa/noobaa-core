import ko from 'knockout';
import numeral from 'numeral';

const uploadStateIconMapping = {
	IN_PORCESS: '/fe/assets/icons.svg#object-in-process',
	SUCCESS: '/fe/assets/icons.svg#object-healthy',
	FAILED: '/fe/assets/icons.svg#object-problem'
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
			() => {
				if (upload().state === 'IN_PROCESS') {
					return numeral(upload().progress).format('0%');
				} else {
					return upload().state;				
				}
			} 
		);
	}
}