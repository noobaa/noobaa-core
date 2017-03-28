import { createReducer } from 'utils/reducer-utils';
import{ updateField } from 'reducers/forms-reducer';
import { mapValues } from 'utils/core-utils';

function onInstallationCommandsFetched(form, { targetPool, excludedDrives, commands }) {
    // Validate that the command is relevant to the current form state.
    const fields = mapValues(form.fields, field => field.value);
    if (
        (fields.targetPool !== targetPool) ||
        (fields.excludeDrives && fields.excludedDrives !== excludedDrives) ||
        (!fields.excludedDrives && excludedDrives.length > 0)
    ) {
        return form;
    }

    return updateField(form, 'commands', commands);
}

export default createReducer({
    NODE_INSTALLATION_COMMANDS_FETCHED: onInstallationCommandsFetched
});
