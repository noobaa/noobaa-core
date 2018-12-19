/* Copyright (C) 2016 NooBaa */

import template from './phone-home-connectivity-sticky.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';
import * as routes from 'routes';

class PhoneHomeConnectivityStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();
    proxySettingsHref = ko.observable();

    selectState(state) {
        const { system, location } = state;
        return [
            system ? system.phoneHome.reachable : true,
            location.params.system
        ];
    }

    mapStateToProps(isPhoneHomeReachable, system) {
        ko.assignToProps(this, {
            isActive: !isPhoneHomeReachable,
            proxySettingsHref: realizeUri(routes.management, {
                system,
                tab: 'settings',
                section: 'proxy-server'
            })
        });
    }
}

export default {
    viewModel: PhoneHomeConnectivityStickyViewModel,
    template: template
};
