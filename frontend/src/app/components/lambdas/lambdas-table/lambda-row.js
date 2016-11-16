import Disposable from 'disposable';
import ko from 'knockout';
import { stringifyAmount } from 'utils';
import { deleteLambda } from 'actions';


export default class LambdaRowViewModel extends Disposable {
    constructor(lambda) {
        super();

        this.state = ko.pureComputed(
            () => lambda() ? {
                name: 'healthy',
                css: 'success',
                tooltip: 'Healthy'
            } : {}
        );

        this.name = ko.pureComputed(
            () => {
                if (!lambda()) {
                    return {};
                }

                let { name } = lambda().config;
                return {
                    text: name,
                    href: { route: 'lambda', params: { lambda: name } }
                };
            }
        );

        this.version = ko.pureComputed(
            () => lambda() && lambda().config.version
        );

        this.description = ko.pureComputed(
            () => lambda() && lambda().config.description
        );

        this.codeSize = ko.pureComputed(
            () => lambda() && lambda().config.code_size
        );

        this.placementPolicy = ko.pureComputed(
            () => {
                if (!lambda()) {
                    return {};
                }

                let { pools } = lambda().config;
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

        this.deleteButton = {
            subject: 'lambda',
            tooltip: 'delete lambda function',
            onDelete: () => deleteLambda(lambda().config)
        };

    }
}
