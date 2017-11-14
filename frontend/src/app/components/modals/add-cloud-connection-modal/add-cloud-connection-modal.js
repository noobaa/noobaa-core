/* Copyright (C) 2016 NooBaa */

import template from './add-cloud-connection-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { isDefined, mapValues, filterValues } from 'utils/core-utils';
import { getFormValues, getFieldValue, isFormValid, getFieldError } from 'utils/form-utils';
import { addExternalConnection } from 'action-creators';
import services from './services';
import { state$, action$ } from 'state';

const formName = 'addCloudConnection';
const nameRegExp = /^Connection (\d+)$/;
const defaultService = 'AWS';
const formTemplates = mapValues(services, spec => spec.template);

function _getAllowedServices(allowedServices) {
    if (!allowedServices) return services;
    return filterValues(
        services,
        (_, service) => allowedServices.includes(service)
    );
}

function _getServiceOptions(services) {
    return Object.entries(services)
        .map(pair => ({
            ...pair[1].option,
            value: pair[0]
        }));
}

function _suggestConnectionName(existing) {
    const suffix = existing
        .map(({ name }) => {
            const match = name.match(nameRegExp);
            return match ? parseInt(match[1]) : 0;
        })
        .reduce(
            // For some reason sending Math.max to reduce reutrns NaN for any value.
            // Using an an arrow function to bypass the problem.
            (max, val) => Math.max(max, val),
            0
        );

    return `Connection ${suffix + 1}`;
}

function _getServiceFormName(service) {
    return `${formName}.${service}`;
}

class addCloudConnectionModalViewModel extends Observer {
    constructor({ onClose, allowedServices = Object.keys(services) }){
        super();

        this.close = onClose;
        this.allowedServices = _getAllowedServices(allowedServices);
        this.serviceOptions = _getServiceOptions(this.allowedServices);
        this.fieldsTemplate = ko.observable();
        this.existingConnections = null;
        this.selectedService = '';
        this.formVM = null;
        this.serviceForm = null;
        this.subTemplate = ko.observable();
        this.areFormsReady = ko.observable();
        this.areFormsValid = ko.observable();
        this.showGlobalError = ko.observable();
        this.globalError = ko.observable();

        this.observe(
            state$.getMany(
                'accounts',
                ['session', 'user'],
                'forms'
            ),
            this.onState
        );
    }

    onState([ accounts, user, forms ]) {
        if (!accounts || !user) {
            this.areFormsReady(false);
            this.areFormsValid(false);
            return;
        }

        this.existingConnections = accounts[user].externalConnections;

        const formState = forms[formName];
        const service = formState ? getFieldValue(formState, 'service') : defaultService;
        const serviceFormName = _getServiceFormName(service);
        const serviceFormState = formState && forms[serviceFormName];

        if (formState && serviceFormState) {
            const globalError = getFieldError(serviceFormState, 'global');
            this.areFormsValid(isFormValid(formState) && isFormValid(serviceFormState));
            this.showGlobalError(isDefined(globalError));
            this.globalError(globalError);

            // Change the sub template only if the service actualy changed
            // preventing unnecessary subTree DOM changes.
            if (!this.subTemplate() || this.subTemplate().service !== service) {
                this.subTemplate({
                    service: service,
                    html: formTemplates[service],
                    data: this.serviceForms[service]
                });
            }

            if (formState.submitted && serviceFormState.submitted) {
                this.onSubmit({
                    ...getFormValues(formState),
                    ...getFormValues(serviceFormState)
                });
            }

        } else {
            this.areFormsValid(false);
            this.globalError('');

            this.form = new FormViewModel({
                name: formName,
                fields: {
                    connectionName: _suggestConnectionName(this.existingConnections),
                    service: defaultService
                },
                onValidate: this.onValidate.bind(this)
            });

            this.serviceForms = mapValues(
                this.allowedServices,
                ({ form }, service) => new FormViewModel({
                    name: _getServiceFormName(service),
                    ...form,
                    onValidate: values => form.onValidate(
                        values,
                        this.existingConnections
                    )
                })
            );
        }

        this.areFormsReady(true);
    }

    onValidate(params) {
        const { connectionName } = params;
        const { existingConnections } = this;
        const errors = {};

        if (!connectionName) {
            errors.connectionName = 'Please enter valid connection name';
        }

        if (existingConnections
            .map(connection => connection.name)
            .includes(connectionName)
        ) {
            errors.connectionName = 'Name already in use';
        }

        return errors;
    }

    submitForms() {
        const { form, serviceForms } = this;
        form.submit();
        serviceForms[form.service()].submit();
    }

    onSubmit(values) {
        const { connectionName, service, ...params } = values;
        action$.onNext(addExternalConnection(connectionName, service, params));
        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form && this.form.dispose();

        Object.values(this.serviceForms || {})
            .forEach(form => form.dispose());

        super.dispose();
    }
}

export default {
    viewModel: addCloudConnectionModalViewModel,
    template: template
};
