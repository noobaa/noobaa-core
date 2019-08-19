/* Copyright (C) 2016 NooBaa */

import template from './regenerate-account-credentials-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, regenerateAccountCredentials } from 'action-creators';
import ko from 'knockout';

class RegenerateAccountCredentialsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    targetAccount = '';
    fields = {
        confirm: ''
    };

    selectState(_, params) {
        return [
            params.accountName
        ];
    }

    mapStateToProps(targetAccount) {
        ko.assignToProps(this, {
            targetAccount
        });
    }

    onValidate(values) {
        const { confirm } = values;
        const errors = {};

        if (confirm.trim().toLowerCase() !== 'regenerate') {
            errors.confirm = 'Please type "regenerate" to confirm your action';
        }

        return errors;
    }

    onSubmit() {
        this.dispatch(
            closeModal(),
            regenerateAccountCredentials(this.targetAccount)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: RegenerateAccountCredentialsModalViewModel,
    template: template
};

