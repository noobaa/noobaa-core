/* Copyright (C) 2016 NooBaa */

import template from './oauth-unauthorized-modal.html';
import ConnectableViewModel from 'components/connectable';
import { navigateTo } from 'utils/browser-utils';

class OauthUnauthorizedModalViewModel extends ConnectableViewModel {
    onBack() {
        // Using navigateTo instead of requestLocation action because
        // login layout was not fully moved to new arch and will not react
        // to state location changes
        // TODO: move to requestLocation action after login layout rewrite
        navigateTo('/fe?skip-oauth');
    }
}

export default {
    viewModel: OauthUnauthorizedModalViewModel,
    template: template
};
