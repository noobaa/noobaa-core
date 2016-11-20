import template from './func-monitoring.html';
import Disposable from 'disposable';
import ko from 'knockout';

class FuncMonitoringViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.ready = ko.pureComputed(
            () => !!func()
        );

        this.func = ko.pureComputed(
            () => func()
        );

        this.stats_last_10_minutes = ko.pureComputed(
            () => func() ? func().stats_last_10_minutes : {}
        );

        this.stats_last_hour = ko.pureComputed(
            () => func() ? func().stats_last_hour : {}
        );

    }

}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
