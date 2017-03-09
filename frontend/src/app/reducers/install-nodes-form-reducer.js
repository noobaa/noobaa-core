import { createReducer } from 'utils/reducer-utils';
import{ updateField, resetField } from 'reducers/forms-reducer';

function onUpdateForm(form, { field }) {
    // Ignore step changes.
    if (field === 'step') {
        return form;
    }

    return resetField(form, 'commnad');
}

function onInstallationCommandFetched(form, { command, osType, excludedDrives }) {
    // Validate that the command is relevant to the current values.
    if (osType !== form.fields.osType.value) {
        return form;
    }

    if (excludedDrives !== form.fields.excludedDrives.value) {
        return form;
    }

    return updateField(form, 'command', command);
}

export default createReducer({
    UPDATE_FORM: onUpdateForm,
    NODE_INSTALLATION_COMMAND_FETCHED: onInstallationCommandFetched
});
