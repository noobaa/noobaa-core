/* Copyright (C) 2016 NooBaa */

import template from './confirm-delete-host-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import { action$ } from 'state';
import { equalIgnoreCase } from 'utils/string-utils';
import { closeModal, deleteHost } from 'action-creators';

const confirmPhrase = 'delete node';

class ConfirmDeleteHostModalViewModel extends Observer {
    formName = this.constructor.name;
    fields = { confirmText: '' };
    host = '';
    fieldLabel = `Type "${confirmPhrase}" to confirm`;

    constructor({ host }) {
        super();

        this.host = ko.unwrap(host);
    }

    onValidate(values) {
        const { confirmText } = values;
        const errors = {};

        if (!equalIgnoreCase(confirmText, confirmPhrase)) {
            errors.confirmText = 'Please enter the requested text';
        }

        return errors;
    }

    onSubmit() {
        action$.next(deleteHost(this.host));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: ConfirmDeleteHostModalViewModel,
    template: template
};
