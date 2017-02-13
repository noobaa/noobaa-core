import template from './modal-manager.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import Modal from './modal';
import ko from 'knockout';
import { last } from 'utils/core-utils';
import { closeModal } from 'dispatchers';

class ModalManagerViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.modals = ko.observableArray();
        this.hasModals = ko.observable();

        // bind the closeTopmost modal the manager.
        this.closeTopmostModal = this.closeTopmostModal.bind(this);
    }

    onState({ modals }, { modals: prevModals }) {
        if (modals === prevModals) {
            return;
        }

        this.modals(
            modals.map(
                (modalState, i) => {
                    const modal = this.modals()[i] || new Modal(this.closeTopmostModal);
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
            this.closeTopmostModal();
        }
    }

    closeTopmostModal() {
        closeModal();
    }
}

export default {
    viewModel: ModalManagerViewModel,
    template: template
};
