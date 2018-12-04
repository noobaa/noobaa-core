/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { deepFreeze, pick, last } from 'utils/core-utils';
import {
    OPEN_MODAL,
    UPDATE_MODAL,
    CLOSE_MODAL,
    UPGRADE_SYSTEM
} from 'action-types';

const optionList = deepFreeze([
    'title',
    'size',
    'severity',
    'closeButton',
    'backdropClose'
]);

// ------------------------------
// Initial State
// ------------------------------
const initialState = [];

// ------------------------------
// Action Handlers
// ------------------------------
function onOpenModal(modals, { payload }) {
    return _openModal(modals, payload);
}

function onUpdateModal(modals, { payload }) {
    if (modals.length > 0) {
        return [
            ...modals.slice(0, -1),
            {
                ...last(modals),
                ...pick(payload, optionList)
            }
        ];
    } else {
        return modals;
    }
}

function onCloseModal(modals, { payload }) {
    return modals.slice(0, -payload.count);
}

function onUpgradeSystem() {
    return _openModal(initialState, {
        component: 'upgrading-system-modal',
        options: {
            title: 'Upgrading NooBaa Version',
            size: 'small',
            backdropClose: false,
            closeButton: 'hidden'
        }
    });
}

// ------------------------------
// Local util functions
// ------------------------------
function _openModal(modals, { component = 'empty', options = {} }) {
    const { name = component, params = {} } = component;
    const {
        title = '',
        size = 'small',
        severity = '',
        closeButton = 'visible',
        backdropClose = true
    } = options;

    return [
        ...modals,
        {
            title,
            size,
            severity,
            backdropClose,
            closeButton,
            component: { name, params }
        }
    ];
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [OPEN_MODAL]: onOpenModal,
    [UPDATE_MODAL]: onUpdateModal,
    [CLOSE_MODAL]: onCloseModal,
    [UPGRADE_SYSTEM]: onUpgradeSystem
});
