/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import{ updateField } from 'reducers/forms-reducer';
import { mapValues, equalItems } from 'utils/core-utils';
import { COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS } from 'action-types';

const initialState = {};

function onCompleteFetchInstallationCommands(form, { payload }) {
    const { targetPool, excludedDrives, commands } = payload;
    // Validate that the command is relevant to the current form state.
    const fields = mapValues(form.fields, field => field.value);
    if (
        (fields.targetPool !== targetPool) ||
        (fields.excludeDrives && !equalItems(fields.excludedDrives, excludedDrives)) ||
        (!fields.excludeDrives && excludedDrives.length > 0)
    ) {
        return form;
    }

    return updateField(form, 'commands', commands);
}

export default createReducer(initialState, {
    [COMPLETE_FETCH_NODE_INSTALLATION_COMMANDS]: onCompleteFetchInstallationCommands
});
