/* Copyright (C) 2016 NooBaa */

import template from './[[name]].html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';

class [[nameCammelCased]]ViewModel extends ConnectableViewModel {
    dataReady = ko.observable();

    selectState(state, params) {

    }

    mapStateToProps() {
        ko.assignToProps(this, {
            dataReady: false
        });
    }
}

export default {
    viewModel: [[nameCammelCased]]ViewModel,
    template: template
};
