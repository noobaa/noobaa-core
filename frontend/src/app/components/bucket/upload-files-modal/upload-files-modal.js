import template from './upload-files-modal.html';
import ko from 'knockout';
import UploadRowViewModel from './upload-row';
import { paginationPageSize } from 'config';
import { makeArray } from 'utils'
import { recentUploads } from 'model';
import { uploadFiles } from 'actions';



class UploadFilesModalViewModel {
	constructor({ bucketName, onClose }){
		this.bucketName = bucketName;
		this.onClose = onClose;
		this.dragCounter = ko.observable(0);
		
		this.files = makeArray(
			paginationPageSize,
			i => new UploadRowViewModel(() => recentUploads()[i])
		);
	}

	dragEnter() {
		this.dragCounter(this.dragCounter() + 1);
		return false;
	}

	dragLeave() {
		this.dragCounter(this.dragCounter() - 1);
		return false;	
	}

	drop(files) {
		this.dragCounter(0);
		this.upload(files);
	}

	upload(files) {
		uploadFiles(this.bucketName(), files);
	}

	close() {
		this.onClose();
	}
}

export default {
	viewModel: UploadFilesModalViewModel,
	template: template
};