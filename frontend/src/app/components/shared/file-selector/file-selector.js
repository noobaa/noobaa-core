import template from './file-selector.html';
import ko from 'knockout';
import { noop } from 'utils';

class FileSelectorViewModel {
<<<<<<< HEAD
    constructor({ onFilesReady = noop, message = 'Drag Here' }) {
        this.dragCounter = ko.observable(0);
        this.onFilesReady = onFilesReady;
        this.message = message;
    }
=======
	constructor({ onFilesReady = noop, allowMultiSelect = false, message = 'Drag Here' }) {
		this.onFilesReady = onFilesReady;
		this.allowMultiSelect = allowMultiSelect
		this.message = message;
		this.dragCounter = ko.observable(0);		
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb

    dragEnter() {
        this.dragCounter(this.dragCounter() + 1);
        return false;
    }

    dragLeave() {
        this.dragCounter(this.dragCounter() - 1);
        return false;    
    }

    dragOver(evt) {
        return false;
    }

<<<<<<< HEAD
    drop({ dataTransfer }) {
        this.dragCounter(0);
        this.onFilesReady(dataTransfer.files);
    }
=======
	drop(files) {
		this.dragCounter(0);
		this.onFilesReady(
			ko.unwrap(this.allowMultiSelect) ? files : files[0]
		);
	}

	select(files) {
		this.onFilesReady(
			ko.unwrap(this.allowMultiSelect) ? files : files[0]
		);
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

export default {
    viewModel: FileSelectorViewModel,
    template: template
}