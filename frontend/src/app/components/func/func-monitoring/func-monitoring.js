import template from './func-monitoring.html';
import Disposable from 'disposable';
import ko from 'knockout';

class FuncMonitoringViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.func = ko.pureComputed(
            () => func()
        );

    }

}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
