import template from './file-selector.html';
import ko from 'knockout';
import { noop } from 'utils';

class FileSelectorViewModel {
    constructor({ onFilesReady = noop, message = 'Drag Here' }) {
        this.dragCounter = ko.observable(0);
        this.onFilesReady = onFilesReady;
        this.message = message;
    }

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

    drop({ dataTransfer }) {
        this.dragCounter(0);
        this.onFilesReady(dataTransfer.files);
    }
}

export default {
    viewModel: FileSelectorViewModel,
    template: template
}