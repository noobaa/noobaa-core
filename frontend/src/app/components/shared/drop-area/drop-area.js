/* Copyright (C) 2016 NooBaa */

import template from './drop-area.html';
import { noop } from 'utils/core-utils';
import ko from 'knockout';

class DropAreaViewModel {
    constructor({
        onDrop = noop,
        disabled = false,
        active = false
    }) {
        this.dropHandler = onDrop;
        this.dragCounter = ko.observable(0);

        this.css = ko.pureComputed(() => ({
            dragover: Boolean(this.dragCounter()),
            disabled: Boolean(ko.unwrap(disabled)),
            active: Boolean(ko.unwrap(active))
        }));

        this.events = {
            dragenter: this.onDragEnter.bind(this),
            dragleave: this.onDragLeave.bind(this),
            dragover: this.onDragOver.bind(this)
        };
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

    onDrop(viewModel, event, parentViewModel) {
        this.dragCounter(0);
        this.dropHandler.call(parentViewModel, viewModel, event);
    }
}

export default {
    viewModel: DropAreaViewModel,
    template: template
};
