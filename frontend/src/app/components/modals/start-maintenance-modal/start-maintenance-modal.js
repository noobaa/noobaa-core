/* Copyright (C) 2016 NooBaa */

import template from './start-maintenance-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { get } from 'rx-extensions';
import { enterMaintenanceMode, closeModal } from 'action-creators';
import { state$, action$ } from 'state';

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

class StartMaintenanceModalViewModel extends Observer {
    formName = this.constructor.name;
    durationUnitOptions = durationUnitOptions;
    durationInMin = ko.observable();

    constructor() {
        super();

        this.form = new FormViewModel({
            name: this.formName,
            fields: {
                duration: 30,
                durationUnit: 1
            },
            onValidate: this.onValidate.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

        this.observe(
            state$.pipe(get('forms', this.formName)),
            this.onState
        );
    }

    onState(form) {
        if (!form) return;

        const { duration, durationUnit } = getFormValues(form);
        const durationInMin = duration * durationUnit;

        this.durationInMin(durationInMin);
    }

    onValidate(values) {
        const { duration } = values;
        const errors = {};

        if (duration === 0) {
            errors.duration = 'Duration cannot be set to 00:00';
        }

        return errors;
    }

    onCancel() {
        action$.next(closeModal());
    }

    onSubmit() {
        action$.next(enterMaintenanceMode(this.durationInMin()));
        action$.next(closeModal());
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: StartMaintenanceModalViewModel,
    template: template
};
