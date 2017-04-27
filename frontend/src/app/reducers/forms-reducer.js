/* Copyright (C) 2016 NooBaa */

import { mapValues } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import { INIT_FORM, UPDATE_FORM, RESET_FORM, RESET_FORM_FIELD,
    SET_FORM_VALIDITY, TOUCH_FORM, DISPOSE_FORM } from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------

function onInitForm(forms, { payload }) {
    const { form: formName, values } = payload;
    const fields = mapValues(
        values,
        value => ({
            initial: value,
            value: value,
            touched: false,
            dirty: false
        })
    );

    return {
        ...forms,
        [formName]: {
            fields: fields,
            errors: {},
            warnings: {},
            validated: false
        }
    };
}

function onUpdateForm(forms, { payload }) {
    const { form, field, value } = payload;
    if (!forms[form]) return forms;
    return {
        ...forms,
        [form]: updateField(forms[form], field, value)
    };
}

function onResetForm(forms, { payload }) {
    const { form } = payload;
    if (!forms[form]) return forms;
    return {
        ...forms,
        [form]: resetForm(forms[form])
    };
}

function onResetFormField(forms, { payload }) {
    const { form, field } = payload;
    if (!forms[form]) return forms;
    return {
        ...forms,
        [form]: resetField(forms[form], field)
    };
}

function onSetFormValidity(forms, { payload }) {
    const { form, errors, warnings } = payload;
    return {
        ...forms,
        [form]: setFormValidity(forms[form], errors, warnings)
    };
}

function onTouchForm(forms, { payload }) {
    const { form } = payload;
    return {
        ...forms,
        [form]: touchForm(forms[form])
    };
}

function onDisposeForm(forms, { payload }) {
    return _removeKey(forms, payload.form);
}

// --------------------------------------------
// Exported utils for manageing the forms state
// --------------------------------------------
export function updateField(form, name, value) {
    const field = form.fields[name];
    if (!field) return form;

    const updatedField = {
        initial: field.initial,
        value: value,
        touched: true,
        dirty: value !== field.initial
    };

    return {
        ...form,
        fields: { ...form.fields, [name]: updatedField },
        validated: false
    };
}

export function resetField(form, name) {
    const field = form.fields[name];
    if (!field) return form;

    const updatedField = {
        initial: field.initial,
        value: field.initial,
        touched: false,
        dirty: false
    };

    return {
        ...form,
        fields: { ...form.fields, [name]: updatedField }
    };
}

export function resetForm(form) {
    const fields = mapValues(form.fields, _restFieldState);
    return {
        ...form, fields,
        errors: {},
        warnings: {}
    };
}

export function setFormValidity(form, errors, warnings) {
    return {
        ...form,
        fields: form.fields,
        errors,
        warnings,
        validated: true
    };
}

export function touchForm(form) {
    return {
        ...form,
        fields: mapValues(form.fields, field => ({ ...field, touched: true }))
    };
}

// --------------------------------------------
// Local util functions
// --------------------------------------------
function _restFieldState(field) {
    return {
        ...field,
        value: field.initial,
        touched: false,
        dirty: false
    };
}

function _removeKey(obj, key) {
    const { [key]: _, ...rest } = obj;
    return rest;
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [INIT_FORM]: onInitForm,
    [UPDATE_FORM]: onUpdateForm,
    [RESET_FORM]: onResetForm,
    [RESET_FORM_FIELD]: onResetFormField,
    [SET_FORM_VALIDITY]: onSetFormValidity,
    [TOUCH_FORM]: onTouchForm,
    [DISPOSE_FORM]: onDisposeForm
});

