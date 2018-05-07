/* Copyright (C) 2016 NooBaa */

import template from './confirm-delete-host-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { action$ } from 'state';
import { equalIgnoreCase } from 'utils/string-utils';
import { closeModal, deleteHost } from 'action-creators';

const formName = 'confirmDeleteHost';
const confirmPhrase = 'delete node';

class ConfirmDeleteHostModalViewModel extends Observer {
    constructor({ host }) {
        super();

        this.host = ko.unwrap(host);
        this.fieldLabel = `Type "${confirmPhrase}" to confirm`;

        this.form = new FormViewModel({
            name: formName,
            fields: {
                confirmText: ''
            },
            onValidate: this.onValidate.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

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

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: ConfirmDeleteHostModalViewModel,
    template: template
};
