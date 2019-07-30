/* Copyright (C) 2016 NooBaa */

import template from './delete-pool-with-data-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { isFieldTouchedAndInvalid } from 'utils/form-utils';
import {
    closeModal,
    deleteResource
} from 'action-creators';

class DeletePoolWithDataWarningModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    poolName = '';
    formattedHostCount = ko.observable();
    isErrorMsgVisible = ko.observable();
    formFields = {
        deleteConfirmed: false,
        rebuildConfirmed: false
    };

    selectState(state, params) {
        const { hostPools, forms } = state;
        return [
            hostPools && hostPools[params.poolName],
            forms[this.formName]
        ];
    }

    mapStateToProps(pool, form) {
        if (!pool || !form) {
            return;
        }

        const isErrorMsgVisible =
            isFieldTouchedAndInvalid(form, 'deleteConfirmed') ||
            isFieldTouchedAndInvalid(form, 'rebuildConfirmed');

        ko.assignToProps(this, {
            poolName: pool.name,
            formattedHostCount: numeral(pool.configuredHostCount).format(','),
            isErrorMsgVisible
        });
    }

    onValidate(values) {
        const errors = {};
        const { deleteConfirmed, rebuildConfirmed } = values;

        if (!deleteConfirmed) {
            errors.deleteConfirmed = '';
        }

        if (!rebuildConfirmed) {
            errors.rebuildConfirmed = '';
        }

        return errors;
    }

    onSubmit() {
        this.dispatch(
            closeModal(),
            deleteResource(this.poolName)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DeletePoolWithDataWarningModalViewModel,
    template: template
};
