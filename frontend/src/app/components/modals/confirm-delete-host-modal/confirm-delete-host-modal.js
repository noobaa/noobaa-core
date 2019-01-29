/* Copyright (C) 2016 NooBaa */

import template from './confirm-delete-host-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { equalIgnoreCase } from 'utils/string-utils';
import { closeModal, deleteHost } from 'action-creators';

const confirmPhrase = 'delete node';

class ConfirmDeleteHostModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    host = '';
    fieldLabel = `Type "${confirmPhrase}" to confirm`;
    fields = {
        confirmText: ''
    };

    selectState(_, params) {
        return [
            params.host
        ];
    }

    mapStateToProps(host) {
        ko.assignToProps(this, {
            host
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
        this.dispatch(
            closeModal(),
            deleteHost(this.host)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: ConfirmDeleteHostModalViewModel,
    template: template
};
