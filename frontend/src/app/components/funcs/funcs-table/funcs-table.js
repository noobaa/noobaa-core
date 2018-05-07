/* Copyright (C) 2016 NooBaa */

import template from './funcs-table.html';
import FuncRowViewModel from './func-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { systemInfo } from 'model';
import { action$ } from 'state';
import { openCreateFuncModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'function name',
        type: 'link'
    },
    {
        name: 'description'
    },
    {
        name: 'version',
        label: 'version'
    },
    {
        name: 'codeSize'
    },
    {
        name: 'placementPolicy'
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const createFuncTooltip = {
    align: 'end',
    text: 'Create function not available'
};

class FuncsTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.columns = columns;
        this.funcs = ko.pureComputed(() =>
            (systemInfo() ? systemInfo().functions : []).map(func => {
                const { name, version, ...config } = func.config;
                return { name, version, config };
            })
        );

        this.createFuncToolTip = createFuncTooltip;
    }

    newFuncRow(func) {
        return new FuncRowViewModel(func);
    }

    onCreateFunc() {
        action$.next(openCreateFuncModal());
    }
}

export default {
    viewModel: FuncsTableViewModel,
    template: template
};
