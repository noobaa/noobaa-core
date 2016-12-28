import template from './welcome-modal.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { sleep } from 'utils/all';

const loadingDelay = 2000;

class WelcomeModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        this.loading = ko.observable(true);
        sleep(loadingDelay).then(
            () => this.loading(false)
        );
    }

    start() {
        this.onClose();
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};
