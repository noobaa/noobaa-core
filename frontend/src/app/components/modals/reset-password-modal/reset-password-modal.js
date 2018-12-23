/* Copyright (C) 2016 NooBaa */

import template from './reset-password-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';
import { closeModal, updateModal, resetAccountPassword } from 'action-creators';
import { api } from 'services';

class RestPasswordModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    accountName = ko.observable();
    formFields = {
        verificationPassword: ''
    };

    selectState(state, params) {
        return [
            params.accountName
        ];
    }

    mapStateToProps(accountName) {
        ko.assignToProps(this, {
            accountName
        });
    }

    onValidate(values) {
        const { verificationPassword } = values;
        const errors = {};

        if (verificationPassword.trim() === '') {
            errors.verificationPassword = 'Please enter your current password';
        }

        return errors;
    }

    async onValidateSubmit(values) {
        const { verificationPassword: verification_password } = values;
        const errors = {};

        const verified = await api.account.verify_authorized_account({ verification_password });
        if (!verified) {
            errors.verificationPassword = 'Please make sure your password is correct';
        }

        return errors;
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onSubmit(values) {
        const { verificationPassword } = values;
        const accountName = this.accountName();
        const newPassword = randomString();

        const lockModalAction = updateModal({
            backdropClose: false,
            closeButton: 'disabled'
        });

        const resetAction = resetAccountPassword(verificationPassword, accountName, newPassword);

        this.dispatch(
            lockModalAction,
            resetAction
        );
    }
}

export default {
    viewModel: RestPasswordModalViewModel,
    template: template
};
