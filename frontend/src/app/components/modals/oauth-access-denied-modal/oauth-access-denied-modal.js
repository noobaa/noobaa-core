/* Copyright (C) 2016 NooBaa */

import template from './oauth-access-denied-modal.html';
import ConnectableViewModel from 'components/connectable';
import { navigateTo } from 'utils/browser-utils';

class OAuthAccessDeniedModalViewModel extends ConnectableViewModel {

    onBack() {
        // Using navigateTo instead of requestLocation action because
        // login layout was not fully moved to new arch and will not react
        // to state location changes
        // TODO: move to requestLocation action after login layout rewrite
        navigateTo('/fe');
    }
}

export default {
    viewModel: OAuthAccessDeniedModalViewModel,
    template: template
};
