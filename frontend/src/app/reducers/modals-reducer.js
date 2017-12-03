/* Copyright (C) 2016 NooBaa */

import { createReducer } from 'utils/reducer-utils';
import { pick, last } from 'utils/core-utils';
import {
    OPEN_MODAL,
    UPDATE_MODAL,
    REPLACE_MODAL,
    LOCK_MODAL,
    CLOSE_MODAL,
    CHANGE_LOCATION,
    COMPLETE_FETCH_SYSTEM_INFO
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

function onChangeLocation(modals, { payload: location }) {
    const { afterupgrade, welcome } = location.query;

    if (afterupgrade) {
        return _openModal(modals, {
            component: 'after-upgrade-modal',
            options: {
                size: 'xsmall',
                severity: 'success',
                title: 'Upgrade was successful'
            }
        });
    }

    if (welcome) {
        return _openModal(modals, {
            component: 'welcome-modal',
            options: {
                size: 'xsmall',
                severity: 'success',
                title: 'System Created Successfully',
                backdropClose: false,
                closeButton: 'hidden'
            }
        });
    }

    return initialState;
}

function onCompleteFetchSystemInfo(modals, { payload }) {
    if (payload.phone_home_config.upgraded_cap_notification) {
        return _openModal(modals, {
            component: 'upgraded-capacity-notification-modal'
        });

    }

    const topMostModal = last(modals);
    if(
        _isSystemUpgrading(payload) &&
        (!topMostModal || topMostModal.component !== 'upgrade-system-modal')
    ) {
        // Close all upgrading modals and open the upgrade system modal.
        return _openModal([], {
            component: 'upgrading-system-modal',
            options: {
                title: 'Upgrading NooBaa Version',
                size: 'small',
                backdropClose: false,
                closeButton: 'hidden'
            }
        });
    }

    return modals;
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

function _isSystemUpgrading(sysInfo) {
    return sysInfo.cluster.shards
        .some(shard => shard.servers
            .some(server => {
                const { status } = server.upgrade;
                return status === 'PRE_UPGRADE_PENDING' ||
                    status === 'PRE_UPGRADE_READY';
            })
        );
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
    [CHANGE_LOCATION]: onChangeLocation,
    [COMPLETE_FETCH_SYSTEM_INFO]: onCompleteFetchSystemInfo
});
