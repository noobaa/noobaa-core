/* Copyright (C) 2016 NooBaa */

import template from './start-maintenance-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { enterMaintenanceMode, closeModal } from 'action-creators';

const durationUnitOptions = deepFreeze([
    {
        label: 'Minutes',
        value: 1
    },
    {
        label: 'Hours',
        value: 60
    }
]);

class StartMaintenanceModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    durationUnitOptions = durationUnitOptions;
    durationInMin = ko.observable();
    fields = {
        duration: 30,
        durationUnit: 1
    };

    selectState(state) {
        return [
            state.forms[this.formName]
        ];
    }

    mapStateToProps(form) {
        if (!form) return;

        const { duration, durationUnit } = getFormValues(form);
        const durationInMin = duration * durationUnit;

        ko.assignToProps(this, {
            durationInMin
        });

    }

    onValidate(values) {
        const { duration } = values;
        const errors = {};

        if (!Number.isInteger(duration)) {
            errors.duration = 'Please enter a whole number';

        } else if (duration <= 0) {
            errors.duration = 'Please enter a number greater then 0';

        }

        return errors;
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onSubmit() {
        this.dispatch(
            closeModal(),
            enterMaintenanceMode(this.durationInMin())
        );
    }
}

export default {
    viewModel: StartMaintenanceModalViewModel,
    template: template
};
