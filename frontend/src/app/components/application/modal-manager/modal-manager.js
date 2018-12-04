/* Copyright (C) 2016 NooBaa */

import template from './modal-manager.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, last } from 'utils/core-utils';
import { closeModal } from 'action-creators';

const severityMapping = deepFreeze({
    info: {
        icon: 'notif-info',
        css: 'info'
    },
    success: {
        icon: 'notif-success',
        css: 'success'
    },
    warning: {
        icon: 'problem',
        css: 'warning'
    },
    error: {
        icon: 'problem',
        css: 'error'
    }
});

class ModalViewModel {
    manager = null;
    css = ko.observable();
    title = {
        text: ko.observable(),
        css: ko.observable(),
        icon: ko.observable()
    };
    xButton = {
        visible: ko.observable(),
        disabled: ko.observable()
    };
    component = {
        name: ko.observable(),
        params: ko.observable()
    };

    constructor({ manager }) {
        this.manager = manager;
    }

    onX() {
        this.manager.onModalX();
    }
}

class ModalManagerViewModel extends ConnectableViewModel {
    hasModals = ko.observable();
    allowBackdropClose = ko.observable();
    modals = ko.observableArray()
        .ofType(ModalViewModel, { manager: this });

    selectState(state) {
        return [
            state.modals
        ];
    }

    mapStateToProps(modals) {
        const hasModals = modals.length > 0;

        ko.assignToProps(this, {
            hasModals,
            allowBackdropClose: hasModals ? last(modals).backdropClose : false,
            modals: modals.map((modal, i) => {
                const { size, title: text, severity, closeButton, component } = modal;
                const { icon, css } = severityMapping[severity] || {};

                // Updating the component observables will cause a re-rendering
                // of the modal content so we check that the component changed
                // before updating the observable.
                const modalVM = this.modals.peek()[i];
                const componentChanged = !modalVM || (modalVM.component.name() !== component.name);

                return {
                    css: `${size ? `modal-${size}` : ''} ${component.name}`,
                    title: { text, css, icon },
                    xButton: {
                        visible: closeButton !== 'hidden',
                        disabled: closeButton === 'disabled'
                    },
                    component: componentChanged ? component : undefined
                };
            })
        });
    }

    onBackdrop() {
        if (this.allowBackdropClose()) {
            this.dispatch(closeModal());
        }
    }

    onModalX() {
        this.dispatch(closeModal());
    }

    onKeyDown(_, evt) {
        if (evt.code.toLowerCase() === 'escape') {
            this.dispatch(closeModal());
            return false;
        }

        return true;
    }
}

export default {
    viewModel: ModalManagerViewModel,
    template: template
};
