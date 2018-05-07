/* Copyright (C) 2016 NooBaa */

import template from './modal-manager.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import Modal from './modal';
import ko from 'knockout';
import { last } from 'utils/core-utils';
import { get } from 'rx-extensions';
import { closeModal, updateModal } from 'action-creators';

class ModalManagerViewModel extends Observer {
    constructor() {
        super();

        this.modals = ko.observableArray();
        this.hasModals = ko.observable();

        this.observe(
            state$.pipe(get('modals')),
            this.onModals
        );
    }

    onModals(modals) {
        const modalParams = {
            onClose: this.onClose,
            onUpdateOptions: this.onUpdateOptions
        };

        this.modals(
            modals.map(
                (modalState, i) => {
                    const modal = this.modals()[i] || new Modal(modalParams);
                    modal.onState(modalState);
                    return modal;
                }
            )
        );

        this.hasModals(modals.length > 0);
    }

    onBackdrop() {
        const top = last(this.modals());
        if (top && top.backdropClose()) {
            action$.next(closeModal());
        }
    }

    onClose() {
        action$.next(closeModal());
    }

    onKeyDown(_, evt) {
        if (evt.code.toLowerCase() === 'escape') {
            action$.next(closeModal());
            return false;
        }

        return true;
    }

    onUpdateOptions(options) {
        action$.next(updateModal(options));
    }
}

export default {
    viewModel: ModalManagerViewModel,
    template: template
};
