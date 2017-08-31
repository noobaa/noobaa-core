/* Copyright (C) 2016 NooBaa */

import template from './file-selector.html';
import ko from 'knockout';
import { noop } from 'utils/core-utils';

class FileSelectorViewModel {
    constructor({
        onFilesReady = noop,
        allowMultiSelect = false,
        filter = '',
        message = `Drag your file${allowMultiSelect ? 's' : ''} here`,
        disabled = false
    }) {
        this.onFilesReady = onFilesReady;
        this.allowMultiSelect = allowMultiSelect;
        this.filter = filter;
        this.message = message;
        this.disabled = disabled;
        this.dragCounter = ko.observable(0);
    }

    onDragEnter() {
        this.dragCounter(this.dragCounter() + 1);
        return false;
    }

    onDragLeave() {
        this.dragCounter(this.dragCounter() - 1);
        return false;
    }

    onDragOver() {
        return false;
    }

    onDrop(_, { dataTransfer }) {
        const files = dataTransfer.files;
        this.dragCounter(0);
        this.onFilesReady(
            ko.unwrap(this.allowMultiSelect) ? files : files[0]
        );
    }

    onChange(_, { target }) {
        const files = target.files;
        this.onFilesReady(
            ko.unwrap(this.allowMultiSelect) ? files : files[0]
        );
    }

    onClick(_, { target }) {
        // Fixes the problem of traiying to select a file with the same name
        // twice in a row.
        target.value = '';
        return true;
    }
}

export default {
    viewModel: FileSelectorViewModel,
    template: template
};
