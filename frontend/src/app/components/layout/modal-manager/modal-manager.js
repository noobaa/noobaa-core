import template from './modal-manager.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import Modal from './modal';
import ko from 'knockout';
import { last } from 'utils/core-utils';
import { closeActiveModal } from 'dispatchers';

class ModalManagerViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.modals = ko.observableArray();
        this.hasModals = ko.observable();

        // bind the closeTopmost modal the manager.
        this.closeActiveModal = closeActiveModal;
    }

    stateEventsFilter(state) {
        return [ state.modals ];
    }

    onState({ modals }) {
        this.modals(
            modals.map(
                (modalState, i) => {
                    const modal = this.modals()[i] || new Modal(this.closeActiveModal);
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
            this.closeActiveModal();
        }
    }
}

export default {
    viewModel: ModalManagerViewModel,
    template: template
};
