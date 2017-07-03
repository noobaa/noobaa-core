/* Copyright (C) 2016 NooBaa */

import template from './update-system-name-modal.html';
import BaseViewModel from 'components/base-view-model';
import { updateHostname } from 'actions';
import ko from 'knockout';
import { action$ } from 'state';
import { lockModal } from 'action-creators';

class UpdatingSystemNameModalViewModel extends BaseViewModel {
    constructor({ name, onClose }) {
        super();

        this.name = name;
        this.onClose = onClose;
        this.updating = ko.observable(false);
    }

    update() {
        this.updating(true);
        action$.onNext(lockModal());
        updateHostname(ko.unwrap(this.name));
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: UpdatingSystemNameModalViewModel,
    template: template
};
