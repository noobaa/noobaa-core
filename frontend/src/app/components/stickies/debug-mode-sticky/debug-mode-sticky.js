/* Copyright (C) 2016 NooBaa */

import template from './debug-mode-sticky.html';
import ConnectableViewModel from 'components/connectable';
import { setSystemDebugLevel } from 'action-creators';
import ko from 'knockout';

class DebugModeStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();

    selectState(state) {
        const { system } = state;
        return [
            system && system.debug.level
        ];
    }

    mapStateToProps(debugLevel) {
        ko.assignToProps(this, {
            isActive: debugLevel > 0
        });
    }

    onTurnOffDebugMode() {
        this.dispatch(setSystemDebugLevel(0));
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

