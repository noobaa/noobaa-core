/* Copyright (C) 2016 NooBaa */

import template from './phone-home-connectivity-sticky.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class PhoneHomeConnectivityStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();

    selectState(state) {
        const { system } = state;
        return [
            system ? system.phoneHome.reachable : true
        ];
    }

    mapStateToProps(isPhoneHomeReachable) {
        ko.assignToProps(this, {
            isActive: !isPhoneHomeReachable
        });
    }
}

export default {
    viewModel: PhoneHomeConnectivityStickyViewModel,
    template: template
};
