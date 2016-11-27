import template from './funcs-table.html';
import FuncRowViewModel from './func-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils/all';
import { funcList } from 'model';

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

class FuncsTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;
        this.funcs = funcList;
        this.isCreateFuncWizardVisible = ko.observable(false);
        this.createFuncToolTip = 'Create function not available';
    }

    newFuncRow(func) {
        return new FuncRowViewModel(func);
    }

    showCreateFuncWizard() {
        this.isCreateFuncWizardVisible(true);
    }

    hideCreateFuncWizard() {
        this.isCreateFuncWizardVisible(false);
    }
}

export default {
    viewModel: FuncsTableViewModel,
    template: template
};
