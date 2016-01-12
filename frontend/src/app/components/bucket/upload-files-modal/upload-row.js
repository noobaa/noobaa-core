import ko from 'knockout';
import numeral from 'numeral';

const uploadStateIconMapping = {
	UPLOADING: '/fe/assets/icons.svg#object-in-process',
	COMPLETED: '/fe/assets/icons.svg#object-healthy',
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
			() => upload().state === 'UPLOADING' ?
				numeral(upload().progress).format('0%') :
				upload().state
		);

		this.toolTip = ko.pureComputed(
			() => upload().state === 'FAILED' ? upload().error : undefined
		);
	}
}