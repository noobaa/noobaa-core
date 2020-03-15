/* Copyright (C) 2016 NooBaa */

import template from './oauth-callback.html';
import ConnectableViewModel from 'components/connectable';
import {
    requestLocation,
    signInWithOAuth,
    openOAuthAccessDeniedModal
} from 'action-creators';

class OAuthCallbackViewModel extends ConnectableViewModel {
    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { pathname, query } = location;
        if (query.code) {
            // Redirect back to requested location.
            if (query.state && pathname !== query.state) {
                this.dispatch(requestLocation(query.state, true));
            }

            // Sign in with the outh grant code.
            this.dispatch(signInWithOAuth(query.code));
        }

        if (query.error === 'access_denied') {
            this.dispatch(openOAuthAccessDeniedModal());
        }


    }
}

export default {
    viewModel: OAuthCallbackViewModel,
    template: template
};
