import { createReducer } from 'utils/reducer-utils';
import { pick, last } from 'utils/core-utils';

// ------------------------------
// Action Handlers
// ------------------------------
function onInit() {
    return [];
}

function onModalOpen(modals, { component = 'empty', options = {} }) {
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

function onModalUpdate(modals, action) {
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

function onModalClose(modals) {
    return modals.slice(0, -1);
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    INIT: onInit,
    MODAL_OPEN: onModalOpen,
    MODAL_UPDATE: onModalUpdate,
    MODAL_CLOSE: onModalClose
});
