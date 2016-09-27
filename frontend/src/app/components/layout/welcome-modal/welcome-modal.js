import template from './welcome-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { waitFor } from 'utils';

const loadingDelay = 2000;

class WelcomeModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        this.loading = ko.observable(true);
        waitFor(loadingDelay).then(
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
