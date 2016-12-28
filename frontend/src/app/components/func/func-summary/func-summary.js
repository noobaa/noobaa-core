import template from './func-summary.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { stringifyAmount } from 'utils/all';

class FuncSummaryViewModel extends BaseViewModel {
    constructor({ func }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!func()
        );

        let config = ko.pureComputed(
            () => func() ? func().config : {}
        );

        this.state = ko.pureComputed(
            () => ({
                text: 'Deployed',
                css: 'success',
                icon: 'healthy'
            })
        );

        this.name = ko.pureComputed(
            () => config().name
        );

        this.version = ko.pureComputed(
            () => config().version
        );

        this.description = ko.pureComputed(
            () => config().description
        );

        this.runtime = ko.pureComputed(
            () => config().runtime
        );

        this.codeSize = ko.pureComputed(
            () => config().code_size
        ).extend({
            formatSize: true
        });

        this.memorySize = ko.pureComputed(
            () => (config().memory_size || 0) * 1024 * 1024
        ).extend({
            formatSize: true
        });

        this.lastModified = ko.pureComputed(
            () => config().last_modified
        ).extend({
            formatTime: true
        });

        this.placementPolicy = ko.pureComputed(
            () => {
                let { pools } = config();
                if (!pools) {
                    return '';
                }

                return {
                    text: `on ${stringifyAmount('pool', pools.length)}`,
                    tooltip: pools
                };
            }
        );

    }
}

export default {
    viewModel: FuncSummaryViewModel,
    template: template
};
