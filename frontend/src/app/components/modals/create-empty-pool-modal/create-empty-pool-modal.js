/* Copyright (C) 2016 NooBaa */

import template from './create-empty-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import { throttle } from 'utils/core-utils';
import { inputThrottle } from 'config';
import { validateName } from 'utils/validation-utils';
import { getFieldValue, isFieldTouched } from 'utils/form-utils';
import ko from 'knockout';
import {
    updateForm,
    createHostsPool,
    closeModal
} from 'action-creators';

class CreateEmptyPoolModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    poolNames = [];
    nameRestrictionList = ko.observableArray();
    fields = {
        poolName: ''
    }

    selectState(state) {
        return [
            state.hostPools,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(hostPools, form) {
        if (!hostPools) {
            return false;
        }

        const poolNames = Object.keys(hostPools);
        const poolName = form ? getFieldValue(form, 'poolName'): '';
        const isPoolNameTouched = form ? isFieldTouched(form, 'poolName') : false;
        const validationResults = form ? validateName(poolName, poolNames) : [];

        ko.assignToProps(this, {
            poolNames,
            nameRestrictionList: validationResults.map(record => ({
                label: record.message,
                css: isPoolNameTouched ? (record.valid ? 'success' : 'error') : ''
            }))
        });

    }

    onPoolName = throttle(
        poolName => this.dispatch(updateForm(this.formName, { poolName })),
        inputThrottle,
        this
    );

    onValidate(values) {
        const { poolName } = values;
        const errors = {};

        const hasNameErrors = validateName(poolName, this.poolNames)
            .some(({ valid }) => !valid);

        if (hasNameErrors) {
            errors.poolName = '';
        }

        return errors;
    }

    onSubmit(values) {
        this.dispatch(
            createHostsPool(values.poolName, []),
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: CreateEmptyPoolModalViewModel,
    template: template
};
