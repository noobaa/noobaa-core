/* Copyright (C) 2016 NooBaa */

import template from './update-system-name-modal.html';
import { updateHostname } from 'actions';
import ko from 'knockout';
import { action$ } from 'state';
import { updateModal, closeModal } from 'action-creators';

class UpdatingSystemNameModalViewModel {
    constructor({ name }) {
        this.name = name;
        this.updating = ko.observable(false);
    }

    onUpdate() {
        this.updating(true);
        action$.next(updateModal({
            backdropClose: false,
            closeButton: 'disabled'
        }));
        updateHostname(ko.unwrap(this.name));
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: UpdatingSystemNameModalViewModel,
    template: template
};
