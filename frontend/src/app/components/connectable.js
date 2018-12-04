/* Copyright (C) 2016 NooBaa */

import { equalItems } from 'utils/core-utils';
import ko from 'knockout';

const subSym = Symbol('Props subscription');
const lastSelectionSym = Symbol('Last state selection');
const actionsSym = Symbol('Actions stream');

function _isStateSelectionValid(selection) {
    return true &&
        Array.isArray(selection) &&
        selection.every(Object.isFrozen);
}

export default class ConnectableViewModel {
    [actionsSym] = null;
    [lastSelectionSym] = [];
    [subSym] = null;

    constructor (params = {}, { state$, action$ }) {
        this[actionsSym] = action$;

        // Schedule the computed on the ko tasks queue to ensure that the
        // sub class constructor run and initialize fields before calling
        // first onState.
        ko.tasks.schedule(() => {
            const state = ko.fromRx(state$);
            this[subSym] = ko.computed(() =>
                this.onState(state(), ko.deepUnwrap(params))
            );
        });
    }

    onState(state, params) {
        if (!state) return;

        const selection  = this.selectState(state, params);
        if (!_isStateSelectionValid(selection)) {
            throw new Error('Invalid state selection');
        }

        if (!equalItems(this[lastSelectionSym], selection)) {
            this[lastSelectionSym] = selection;
            this.mapStateToProps(...selection);

        }
    }

    selectState(/*state, params*/) {
        return [];
    }

    mapStateToProps(/*...selection*/) {
    }

    dispatch(...actions) {
        const action$ = this[actionsSym];
        for (const action of actions) {
            action$.next(action);
        }
    }

    dispose() {
        this[subSym].dispose();
    }
}
