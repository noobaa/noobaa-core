/* Copyright (C) 2016 NooBaa */

import template from './regenerate-account-credentials-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, regenerateAccountCredentials } from 'action-creators';
import { api } from 'services';
import ko from 'knockout';

class RegenerateAccountCredentialsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    targetAccount = '';
    fields = {
        userPassword: ''
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
        const { userPassword } = values;
        const errors = {};

        if (!userPassword) {
            errors.userPassword = 'Password is required for security purposes';
        }

        return errors;
    }

    async onValidateSubmit(values) {
        const { userPassword: verification_password } = values;
        const errors = {};

        const verified = await api.account.verify_authorized_account({ verification_password });
        if (!verified) {
            errors.userPassword = 'Please make sure your password is correct';
        }

        return errors;
    }

    onSubmit(values) {
        const { userPassword } = values;
        this.dispatch(
            closeModal(),
            regenerateAccountCredentials(this.targetAccount, userPassword)
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

