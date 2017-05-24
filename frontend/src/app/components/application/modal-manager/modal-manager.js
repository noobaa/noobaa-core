/* Copyright (C) 2016 NooBaa */

import template from './modal-manager.html';
import Observer from 'observer';
import { state$ } from 'state';
import Modal from './modal';
import ko from 'knockout';
import { last } from 'utils/core-utils';
import { closeActiveModal } from 'dispatchers';

class ModalManagerViewModel extends Observer {
    constructor() {
        super();

        this.modals = ko.observableArray();
        this.hasModals = ko.observable();

        this.observe(state$.get('modals'), this.onModals);
    }

    onModals(modals) {
        this.modals(
            modals.map(
                (modalState, i) => {
                    const modal = this.modals()[i] || new Modal(() => closeActiveModal());
                    modal.update(modalState);
                    return modal;
                }
            )
        );

        this.hasModals(modals.length > 0);
    }

    onBackdrop() {
        const top = last(this.modals());
        if (top && top.backdropClose()) {
            closeActiveModal();
        }
    }
}

export default {
    viewModel: ModalManagerViewModel,
    template: template
};
