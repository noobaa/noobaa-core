import template from './func-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { stringifyAmount } from 'utils';

class FuncSummaryViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!func()
        );

        this.state = ko.pureComputed(
            () => ({
                text: 'Ready',
                css: 'success',
                icon: 'healthy'
            })
        );

        this.name = ko.pureComputed(
            () => func() && func().config.name
        );

        this.version = ko.pureComputed(
            () => func() && func().config.version
        );

        this.description = ko.pureComputed(
            () => func() && func().config.description
        );

        this.runtime = ko.pureComputed(
            () => func() && func().config.runtime
        );

        this.codeSize = ko.pureComputed(
            () => func() ? func().config.code_size : {}
        ).extend({
            formatSize: true
        });

        this.memorySize = ko.pureComputed(
            () => func() ? func().config.memory_size * 1024 * 1024 : {}
        ).extend({
            formatSize: true
        });

        this.lastModified = ko.pureComputed(
            () => func() ? func().config.last_modified : {}
        ).extend({
            formatTime: true
        });

        this.placementPolicy = ko.pureComputed(
            () => {
                if (!func()) {
                    return {};
                }

                let { pools } = func().config;
                let count = pools && pools.length || 0;

                let text = `on ${
                        stringifyAmount('pool', count)
                    }`;

                return {
                    text: text,
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
