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
    }

    onDrop(_, evt) {
        const { files } = evt.dataTransfer;
        const payload = ko.unwrap(this.allowMultiSelect) ? files : files[0];
        this.onFilesReady(payload);
    }

    onChange(_, evt) {
        const { files } = evt.target;
        const payload = ko.unwrap(this.allowMultiSelect) ? files : files[0];
        this.onFilesReady(payload);
    }

    onClick(_, evt) {
        // Fixes the problem of traiying to select a file with the same name
        // twice in a row.
        evt.target.value = '';
        return true;
    }
}

export default {
    viewModel: FileSelectorViewModel,
    template: template
};
