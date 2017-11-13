/* Copyright (C) 2016 NooBaa */

import { mapValues } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import {
    INIT_FORM,
    UPDATE_FORM,
    RESET_FORM,
    TOUCH_FORM,
    SET_FORM_VALIDITY,
    LOCK_FORM,
    UNLOCK_FORM,
    DROP_FROM
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

const initialFormState = {
    fields: {},
    warnings: {},
    syncErrors: {},
    asyncErrors: {},
    validatingAsync: null,
    validated: false,
    locked: false
};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitForm(forms, { payload }) {
    if (forms[payload.form]) return forms;

    const fields = mapValues(
        payload.values,
        _initializeValue
    );

    return {
        ...forms,
        [payload.form]: {
            ...initialFormState,
            fields
        }
    };
}

function onUpdateForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    const updates = payload.values;
    const fields = mapValues(
        form.fields,
        (field, name) => {
            if (!updates.hasOwnProperty(name)) {
                return field;
            }

            return {
                ...field,
                value: updates[name],
                touched: field.touched || payload.touch
            };
        }
    );

    return {
        ...forms,
        [payload.form]: {
            ...form,
            fields,
            validated: false
        }
    };
}

function onResetForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    const fields = mapValues(
        form.fields,
        ({ initial }) => _initializeValue(initial)
    );

    return {
        ...forms,
        [payload.form]: {
            ...initialFormState,
            fields
        }
    };
}

function onTouchForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    const touchList = payload.fields || Object.keys(form.fields);
    const fields = mapValues(
        form.fields,
        (field, name) => touchList.includes(name) ?
            ({ ...field, touched: true }) :
            field
    );

    return {
        ...forms,
        [payload.form]: {
            ...form,
            fields
        }
    };
}

function onSetFormValidity(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    if (Object.keys(payload.values)
        .some(name => form.fields[name].value !== payload.values[name])) {
        return forms;
    }

    const {
        fieldsValidity = {},
        warnings = form.warnings,
        syncErrors = form.syncErrors,
        asyncErrors = form.asyncErrors,
        validatingAsync = form.validatingAsync,
        confirmValidity,
        touch = false
    } = payload;

    const fields = mapValues(
        form.fields,
        (field, name) =>  fieldsValidity[name] ? {
            ...field,
            validity: fieldsValidity[name],
            touched: field.touched || touch
        } : field
    );

    const validated = confirmValidity || form.validated;

    return {
        ...forms,
        [payload.form]: {
            ...form,
            fields,
            warnings,
            syncErrors,
            asyncErrors,
            validatingAsync,
            validated
        }
    };
}

function onLockForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    return {
        ...forms,
        [payload.form]: { ...form, locked: true }
    };
}

function onUnlockForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form) return forms;

    return {
        ...forms,
        [payload.form]: { ...form, locked: false }
    };
}

function onDropForm(forms, { payload }) {
    const { [payload.form]: _, ...other } = forms;
    return other;
}

// ------------------------------
// Local utils function
// ------------------------------
function _initializeValue(value) {
    return {
        initial: value,
        value: value,
        touched: false,
        validity: 'VALID'
    };
}

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer(initialState, {
    [INIT_FORM]: onInitForm,
    [UPDATE_FORM]: onUpdateForm,
    [RESET_FORM]: onResetForm,
    [TOUCH_FORM]: onTouchForm,
    [SET_FORM_VALIDITY]: onSetFormValidity,
    [LOCK_FORM]: onLockForm,
    [UNLOCK_FORM]: onUnlockForm,
    [DROP_FROM]: onDropForm
});

