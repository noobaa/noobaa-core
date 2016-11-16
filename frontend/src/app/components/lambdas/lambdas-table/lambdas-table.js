import template from './lambdas-table.html';
import LambdaRowViewModel from './lambda-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';
import { lambdaFunctions } from 'model';

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
        name: 'description',
        label: 'description'
    },
    {
        name: 'version',
        label: 'version'
    },
    {
        name: 'codeSize',
        label: 'code size'
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

class LambdasTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.lambdas = ko.pureComputed(
            () => lambdaFunctions()
        );

        this.isCreateLambdaWizardVisible = ko.observable(false);
    }

    newLambdaRow(lambda) {
        return new LambdaRowViewModel(lambda);
    }

    showCreateLambdaWizard() {
        this.isCreateLambdaWizardVisible(true);
    }

    hideCreateLambdaWizard() {
        this.isCreateLambdaWizardVisible(false);
    }
}

export default {
    viewModel: LambdasTableViewModel,
    template: template
};
