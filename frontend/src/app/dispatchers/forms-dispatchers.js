/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';

export function initializeForm(form, values = {}) {
    dispatch({ type: 'INIT_FORM', form, values });
}

export function updateForm(form, field, value) {
    dispatch({ type: 'UPDATE_FORM', form, field, value });
}

export function resetForm(form) {
    dispatch({ type: 'RESET_FORM', form });
}

export function restFormField(form, field) {
    dispatch({ type: 'RESET_FORM_FIELD', form, field });
}

export function setFormValidity(form, errors = {}, warnings = {}) {
    dispatch({ type: 'SET_FORM_VALIDITY', form, errors, warnings });
}

export function touchForm(form) {
    dispatch({ type: 'TOUCH_FORM', form });
}

export function disposeForm(form) {
    dispatch({ type: 'DISPOSE_FORM', form });
}
