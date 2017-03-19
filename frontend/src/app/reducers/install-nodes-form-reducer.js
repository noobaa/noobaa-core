import { createReducer } from 'utils/reducer-utils';
import{ updateField, resetField } from 'reducers/forms-reducer';
import { mapValues } from 'utils/core-utils';

function onUpdateForm(form, { form: formName, field }) {
    if (formName !== 'installNodes') {
        return form;
    }

    // Ignore step changes.
    if (field === 'step') {
        return form;
    }

    return resetField(form, 'command');
}

function onInstallationCommandFetched(form, { command, osType, excludedDrives }) {
    // Validate that the command is relevant to the current form state.
    const fields = mapValues(form.fields, field => field.value);
    if (
        (osType !== fields.osType) ||
        (fields.excludeDrives && fields.excludedDrives !== excludedDrives) ||
        (!fields.excludedDrives && excludedDrives.length > 0)
    ) {
        return form;
    }

    return updateField(form, 'command', command);
}

export default createReducer({
    UPDATE_FORM: onUpdateForm,
    NODE_INSTALLATION_COMMAND_FETCHED: onInstallationCommandFetched
});
