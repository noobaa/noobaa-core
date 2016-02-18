import template from './file-selector.html';
import ko from 'knockout';
import { noop } from 'utils';

class FileSelectorViewModel {
    constructor({ 
        onFilesReady = noop, 
        allowMultiSelect = false, 
        filter = '',
        message = 'Drag Here' 
    }) {
        this.onFilesReady = onFilesReady;
        this.allowMultiSelect = allowMultiSelect
        this.filter = filter;
        this.message = message;
        this.dragCounter = ko.observable(0);
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
}

export default {
    viewModel: FileSelectorViewModel,
    template: template
}