/* Copyright (C) 2016 NooBaa */

import { dispatch } from 'state-actions';
import { INIT_FORM, UPDATE_FORM, RESET_FORM, RESET_FORM_FIELD, SET_FORM_VALIDITY,
    TOUCH_FORM, DISPOSE_FORM } from 'action-types';

export function initializeForm(form, values = {}) {
    dispatch({
        type: INIT_FORM,
        payload: { form, values }
    });
}

export function updateForm(form, field, value) {
    dispatch({
        type: UPDATE_FORM,
        payload: { form, field, value }
    });
}

export function resetForm(form) {
    dispatch({
        type: RESET_FORM,
        payload: { paylaod: form }
    });
}

export function restFormField(form, field) {
    dispatch({
        type: RESET_FORM_FIELD,
        payload: { form, field }
    });
}

export function setFormValidity(form, errors = {}, warnings = {}) {
    dispatch({
        type: SET_FORM_VALIDITY,
        payload: { form, errors, warnings }
    });
}

export function touchForm(form) {
    dispatch({
        type: TOUCH_FORM,
        payload: { form }
    });
}

export function disposeForm(form) {
    dispatch({
        type: DISPOSE_FORM,
        payload: { form }
    });
}
