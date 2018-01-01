/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { pick, last } from 'utils/core-utils';
import {
    OPEN_MODAL,
    UPDATE_MODAL,
    REPLACE_MODAL,
    LOCK_MODAL,
    CLOSE_MODAL,
    COMPLETE_FETCH_SYSTEM_INFO,
    UPGRADE_SYSTEM
} from 'action-types';

// ------------------------------
// Initial State
// ------------------------------
const initialState = [];

// ------------------------------
// Action Handlers
// ------------------------------
function onOpenModal(modals, { payload }) {
    const { component = 'empty', options = {} } = payload;
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
        { component: { name, params }, title, size, severity,
            backdropClose, closeButton }
    ];
}

function onUpdateModal(modals, { payload }) {
    if (modals.length > 0) {
        const update = pick(payload, [
            'title',
            'size',
            'severity',
            'closeButton',
            'backdropClose'
        ]);

        return [
            ...modals.slice(0, -1),
            { ...last(modals), ...update }
        ];
    } else {
        return modals;
    }
}

function onReplaceModal(modals, { payload }) {
    if (modals.length === 0) {
        return modals;
    }

    return _openModal(modals.slice(0, -1), payload);
}

function onLockModal(modals) {
    const backdropClose = false;
    const closeButton = 'disabled';
    return [
        ...modals.slice(0, -1),
        { ...last(modals), backdropClose, closeButton }
    ];
}

function onCloseModal(modals) {
    return modals.slice(0, -1);
}

function onCompleteFetchSystemInfo(modals, { payload }) {
    if (payload.phone_home_config.upgraded_cap_notification) {
        return _openModal(modals, {
            component: 'upgraded-capacity-notification-modal'
        });
    }

    return modals;
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
        { component: { name, params }, title, size, severity,
            backdropClose, closeButton }
    ];
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer(initialState, {
    [OPEN_MODAL]: onOpenModal,
    [UPDATE_MODAL]: onUpdateModal,
    [REPLACE_MODAL]: onReplaceModal,
    [LOCK_MODAL]: onLockModal,
    [CLOSE_MODAL]: onCloseModal,
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo,
    [UPGRADE_SYSTEM]: onUpgradeSystem
});
