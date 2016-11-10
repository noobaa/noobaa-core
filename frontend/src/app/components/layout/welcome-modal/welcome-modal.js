import template from './welcome-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { sleep } from 'utils';

const loadingDelay = 2000;

class WelcomeModalViewModel extends Disposable {
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
