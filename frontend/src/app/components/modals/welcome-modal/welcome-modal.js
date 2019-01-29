/* Copyright (C) 2016 NooBaa */

import template from './welcome-modal.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation, closeModal } from 'action-creators';
import ko from 'knockout';

class WelcomeModalViewModel extends ConnectableViewModel {
    systemUri = '';

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        ko.assignToProps(this, {
            systemUri: realizeUri(location.route, location.params)
        });
    }

    onStart() {
        this.dispatch(closeModal());
        this.dispatch(requestLocation(this.systemUri, true));
    }
}

export default {
    viewModel: WelcomeModalViewModel,
    template: template
};
