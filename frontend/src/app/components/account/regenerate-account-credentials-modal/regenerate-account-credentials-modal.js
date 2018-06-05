/* Copyright (C) 2016 NooBaa */

import template from './regenerate-account-credentials-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { action$ } from 'state';
import { closeModal, regenerateAccountCredentials } from 'action-creators';
import { api } from 'services';


class RegenerateAccountCredentialsModalViewModel extends Observer {
    formName = this.constructor.name;
    targetAccount = '';
    form = null;

    constructor({ accountName }) {
        super();

        this.targetAccount = accountName;
        this.form = new FormViewModel({
            name: this.formName,
            fields: {
                userPassword: ''
            },
            onValidate: this.onValidate.bind(this),
            onValidateSubmit: this.onValidateSubmit.bind(this),
            onSubmit: this.onSubmit.bind(this)
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
        action$.next(regenerateAccountCredentials(this.targetAccount, userPassword));
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
    viewModel: RegenerateAccountCredentialsModalViewModel,
    template: template
};

