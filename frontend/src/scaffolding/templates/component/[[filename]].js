/* Copyright (C) 2016 NooBaa */

import template from './[[filename]].html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class [[viewModelName]] extends ConnectableViewModel {
    dataReady = ko.observable();

    selectState(state, params) {
        return [];
    }

    mapStateToProps() {
        if (/* condition*/) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            ko.assignToProps(this, {
                dataReady: true
            });
        }
    }
}

export default {
    viewModel: [[viewModelName]],
    template: template
};
