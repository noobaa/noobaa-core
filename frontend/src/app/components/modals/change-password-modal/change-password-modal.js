/* Copyright (C) 2016 NooBaa */

import template from './change-password-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getFieldValue, isFieldTouched } from 'utils/form-utils';
import { calcPasswordStrength  } from 'utils/password-utils';
import { validatePassword } from 'utils/validation-utils';
import { closeModal, changeAccountPassword } from 'action-creators';
import { api } from 'services';

class ChangePasswordModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    calcPasswordStrength = calcPasswordStrength;
    passwordRestrictionList = ko.observableArray();
    heading = ko.observable();
    accountName = '';
    formFields = {
        password: '',
        newPassword: ''
    };

    selectState(state, params) {
        return [
            params.accountName,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(accountName, form) {
        if (!form) return;

        const newPassword = getFieldValue(form, 'newPassword');
        const passwordRestrictionList = validatePassword(newPassword)
            .map(({ valid, message }) => ({
                label: message,
                css: isFieldTouched(form, 'newPassword') ? (valid ? 'success' : 'error') : ''
            }));

        ko.assignToProps(this, {
            heading: `Change ${accountName} password:`,
            accountName,
            passwordRestrictionList
        });
    }

    onValidate(values) {
        const { password, newPassword } = values;
        const errors = {};

        if (password.trim() === '') {
            errors.password = 'Please enter your current password';
        }

        if (validatePassword(newPassword).some(rule => !rule.valid)) {
            errors.newPassword = '';
        }

        return errors;
    }

    async onValidateSubmit(values) {
        const { password: verification_password } = values;
        const errors = {};

        const verified = await api.account.verify_authorized_account({ verification_password });
        if (!verified) {
            errors.password = 'Please make sure your password is correct';
        }

        return errors;
    }

    onSubmit(values) {
        const { accountName } = this;
        const { password, newPassword } = values;
        this.dispatch(
            closeModal(),
            changeAccountPassword(password, accountName, newPassword)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: ChangePasswordModalViewModel,
    template: template
};
