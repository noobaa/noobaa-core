import template from './lambda-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

const stateMapping = deepFreeze({
    true: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    false: {
        text: 'Offline',
        css: 'error',
        icon: 'problem'
    }
});

class LambdaSummaryViewModel extends Disposable {
    constructor({ lambda }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!lambda()
        );

        this.state = ko.pureComputed(
            () => stateMapping[true]
        );

        this.dataPlacement = ko.pureComputed(
            () => {
                if (!lambda()) {
                    return;
                }

                let { pools } = lambda().config;

                return `on ${
                    pools.length
                } pool${
                    pools.length !== 1 ? 's' : ''
                }`;
            }
        );

        this.codeSize = ko.pureComputed(
            () => lambda() ? lambda().config.code_size : {}
        ).extend({
            formatSize: true
        });

        this.codeSha256 = ko.pureComputed(
            () => lambda() ? lambda().config.code_sha256 : {}
        );

        let stats = ko.pureComputed(
            () => lambda() ? lambda().stats : {}
        );

        this.lastRead = ko.pureComputed(
            () => stats().last_read
        ).extend({
            formatTime: true
        });

        this.lastWrite = ko.pureComputed(
            () => stats().last_write
        ).extend({
            formatTime: true
        });

        this.isPolicyModalVisible = ko.observable(false);
        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isViewCloudSyncModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: LambdaSummaryViewModel,
    template: template
};
