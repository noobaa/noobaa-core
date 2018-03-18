/* Copyright (C) 2016 NooBaa */

import { mapValues } from 'utils/core-utils';
import { createReducer } from 'utils/reducer-utils';
import {
    INIT_FORM,
    UPDATE_FORM,
    RESET_FORM,
    TOUCH_FORM,
    UNTOUCH_FORM,
    SET_FORM_VALIDITY,
    SUBMIT_FORM,
    COMPLETE_SUBMIT_FORM,
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
    submitErrors: {},
    validatingAsync: null,
    validated: false,
    submitting: false,
    submitted: false
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
            validated: false,
            submitted: false,
            submitting: false,
            submitErrors: {}
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
    return _toggleFormTouch(
        forms,
        payload.form,
        payload.fields,
        true
    );
}

function onUntouchForm(forms, { payload }) {
    return _toggleFormTouch(
        forms,
        payload.form,
        payload.fields,
        false
    );
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

function onSubmitForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form || form.submitted) return forms;

    // Touch all the fields.
    const fields = mapValues(
        form.fields,
        field => ({ ...field, touched: true })
    );

    const isValid =
        form.validated &&
        Object.values(form.fields).every(field =>
            field.validity === 'VALID'
        );

    return {
        ...forms,
        [payload.form]: {
            ...form,
            fields,
            submitting: isValid
        }
    };
}

function onCompleteSubmitForm(forms, { payload }) {
    const form = forms[payload.form];
    if (!form || !form.submitting) return forms;

    const { errors } = payload;
    const submitted = Object.keys(errors).length === 0;
    const fields = mapValues(
        form.fields,
        (field, key) => ({
            ...field,
            validity: errors.hasOwnProperty(key) ? 'INVALID' : 'VALID'
        })
    );

    return {
        ...forms,
        [payload.form]: {
            ...form,
            fields,
            submitting: false,
            submitted: submitted,
            submitErrors: errors
        }
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

function _toggleFormTouch(forms, formName, fields, touch) {
    const form = forms[formName];
    if (!form) return forms;

    const touchList = fields || Object.keys(form.fields);
    const fieldsState = mapValues(
        form.fields,
        (field, name) => touchList.includes(name) ?
            ({ ...field, touched: touch }) :
            field
    );

    return {
        ...forms,
        [formName]: {
            ...form,
            fields: fieldsState
        }
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
    [UNTOUCH_FORM]: onUntouchForm,
    [SET_FORM_VALIDITY]: onSetFormValidity,
    [SUBMIT_FORM]: onSubmitForm,
    [COMPLETE_SUBMIT_FORM]: onCompleteSubmitForm,
    [DROP_FROM]: onDropForm
});

