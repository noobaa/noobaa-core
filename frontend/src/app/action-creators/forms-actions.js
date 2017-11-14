/* Copyright (C) 2016 NooBaa */

import {
    INIT_FORM,
    UPDATE_FORM,
    RESET_FORM,
    TOUCH_FORM,
    SET_FORM_VALIDITY,
    LOCK_FORM,
    UNLOCK_FORM,
    SUBMIT_FORM,
    DROP_FROM
} from 'action-types';

export function initializeForm(form, values = {}) {
    return {
        type: INIT_FORM,
        payload: { form, values }
    };
}

export function updateForm(form, values, touch = true) {
    return {
        type: UPDATE_FORM,
        payload: { form, values, touch }
    };
}

export function resetForm(form) {
    return {
        type: RESET_FORM,
        payload: { form }
    };
}

export function touchForm(form, fields) {
    return {
        type: TOUCH_FORM,
        payload: { form, fields }
    };
}

export function setFormValidity(form, validity) {
    return {
        type: SET_FORM_VALIDITY,
        payload: {
            form,
            values: validity.values,
            fieldsValidity: validity.fieldsValidity,
            warnings: validity.warnings,
            syncErrors: validity.syncErrors,
            asyncErrors: validity.asyncErrors,
            validatingAsync: validity.validatingAsync,
            confirmValidity: validity.confirmValidity,
            touch: validity.touch
        }
    };
}

export function submitForm(form) {
    return {
        type: SUBMIT_FORM,
        payload: { form }
    };
}

export function lockForm(form){
    return {
        type: LOCK_FORM,
        payload: { form }
    };
}

export function unlockForm(form){
    return {
        type: UNLOCK_FORM,
        payload: { form }
    };
}

export function dropForm(form) {
    return {
        type: DROP_FROM,
        payload: { form }
    };
}
