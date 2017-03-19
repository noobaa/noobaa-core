import { createReducer } from 'utils/reducer-utils';
import { pick, last } from 'utils/core-utils';

// ------------------------------
// Initial State
// ------------------------------
const initialState = [];

// ------------------------------
// Action Handlers
// ------------------------------
function onInitApplication() {
    return initialState;
}

function onOpenModal(modals, { component = 'empty', options = {} }) {
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

function onUpdateModal(modals, action) {
    if (modals.length > 0) {
        const update = pick(
            action,
            'title',
            'size',
            'severity',
            'closeButton',
            'backdropClose',
        );

        return [
            ...modals.slice(0, -1),
            { ...last(modals), ...update }
        ];
    } else {
        return modals;
    }
}

function onLockActiveModal(modals) {
    const backdropClose = false;
    const closeButton = 'disabled';
    return [
        ...modals.slice(0, -1),
        { ...last(modals), backdropClose, closeButton }
    ];
}

function onCloseActiveModal(modals) {
    return modals.slice(0, -1);
}

function onUpgradeSystem(modals) {
    return onOpenModal(modals, {
        component: {
            name: 'system-upgrade-modal'
        },
        options: {
            size: 'xsmall',
            backdropClose: false
        }
    });
}

function onLocationChanged(modals, { query }) {
    if (query.afterupgrade) {
        return onOpenModal(modals, {
            component: 'after-upgrade-modal',
            options: {
                size: 'xsmall'
            }
        });

    } else if (query.welcome) {
        return onOpenModal(modals, {
            component: 'welcome-modal',
            options: {
                size: 'custom',
                backdropClose: false
            }
        });

    } else {
        return initialState;
    }
}

function onSystemInfoFetched(modals, { info }) {
    if (info.phone_home_config.upgraded_cap_notification) {
        return onOpenModal(modals, {
            component: 'upgraded-capacity-notification-modal'
        });

    } else {
        return modals;
    }
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    INIT_APPLICAITON: onInitApplication,
    OPEN_MODAL: onOpenModal,
    UPDATE_MODAL: onUpdateModal,
    LOCK_ACTIVE_MODAL: onLockActiveModal,
    CLOSE_ACTIVE_MODAL: onCloseActiveModal,
    UPGRADE_SYSTEM: onUpgradeSystem,
    LOCATION_CHANGED: onLocationChanged,
    SYSTEM_INFO_FETCHED: onSystemInfoFetched
});
