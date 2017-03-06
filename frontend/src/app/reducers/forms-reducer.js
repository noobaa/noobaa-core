import { createReducer } from 'utils/reducer-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = {};

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

function onInitForm(forms, { form, values }) {
    return {
        ...forms,
        [form]: {
            initialValues: values,
            values: {}
        }
    };
}

function onUpdateForm(forms, { form, field, value }) {
    if (!forms[form]) {
        return forms;
    }

    return {
        ...forms,
        [form]: {
            ...forms[form],
            values: {
                ...forms[form].values,
                [field] : value
            }
        }
    };
}

function onResetForm(forms, { form }) {
    if (!forms[form]) {
        return forms;
    }

    return {
        ...forms,
        [form]: {
            ...forms[form],
            values: {}
        }
    };
}

function onDisposeForm(forms, { form }) {
    if (!forms[form]) {
        return forms;
    }

    return { ...forms, [form]: undefined };
}

// ------------------------------
// Local util functions
// ------------------------------

// ------------------------------
// Exported reducer function
// ------------------------------
export default createReducer({
    INIT_APPLICAITON: onInitApplication,
    INIT_FORM: onInitForm,
    UPDATE_FORM: onUpdateForm,
    RESET_FORM: onResetForm,
    DISPOSE_FORM: onDisposeForm
});

