/* Copyright (C) 2016 NooBaa */

import Observer from 'observer';
import state$ from 'state';
import { isString, mapValues } from 'utils/core-utils';
import * as actions from 'dispatchers';
import ko from 'knockout';

const nameSym = Symbol('nameSym');

export default class FormViewModal extends Observer {
    get formName() {
        return this[nameSym];
    }

    constructor(formName) {
        if (!isString(formName)) {
            throw TypeError('Invalid formName, formName must be a valid string');
        }

        super();
        this[nameSym] = formName;
        this.initialized = ko.observable();
        this.validated = ko.observable();
        this.valid = ko.observable();

        this.observe(state$.get('forms', formName), this.onForm);
    }

    onForm(form) {
        if (!form) return;
        const { fields, validated, errors } = form;

        // Copy global state.
        this.initialized(true);
        this.validated(validated);
        this.valid(Object.keys(errors).length === 0);

        // Copy fields state.
        for (const [name, field] of Object.entries(fields)) {
            const { value, touched, dirty } = field;
            const obs = this[name];

            // If the value is array we want to be able pass the array to
            // existing widgets which make it impossible to be immutable
            // so we clone it.
            obs(Array.isArray(value) ? Array.from(value) : value);
            obs.touched(touched);
            obs.dirty(dirty);
            obs.error(errors[name]);
        }

        // Validate the form if not validated
        if (form && !form.validated) {
            const values = mapValues(fields, field => field.value);
            const { errors, warnings } = this.validate(values);
            actions.setFormValidity(this.formName, errors, warnings);
        }
    }

    // Override this in derived class with form validation logic.
    validate(/* formValues */) {
        return {};
    }


    initialize(values) {
        if (this.initialized.peek()) {
            console.warn('Form already initialized, ignoring');
            return;
        }

        for (const name of Object.keys(values)) {
            const field = this[name] = ko.observable();
            field.touched = ko.observable();
            field.dirty = ko.observable();
            field.error = ko.observable();
        }


        console.warn(this.formName, values);

        actions.initializeForm(this.formName, values);
    }

    update(field, value) {
        actions.updateForm(this.formName, field, value);
    }

    reset() {
        actions.resetForm(this.formName);
    }

    resetField(field) {
        actions.restFormField(this.formName, field);
    }

    touchAll() {
        actions.touchForm(this.formName);
    }

    dispose() {
        super.dispose();
        actions.disposeForm(this.formName);
    }

    bindToField(fieldName) {
        return ko.pureComputed({
            read: this[fieldName],
            write: val => this.update(fieldName, val)
        });
    }
}
