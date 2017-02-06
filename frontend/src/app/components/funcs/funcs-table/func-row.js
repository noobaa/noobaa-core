import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { deleteFunc } from 'actions';


export default class FuncRowViewModel extends BaseViewModel {
    constructor(func) {
        super();

        let config = ko.pureComputed(
            () => func() ? func().config : {}
        );

        this.state = ko.pureComputed(
            () => ({
                name: 'healthy',
                css: 'success',
                tooltip: 'Deployed'
            })
        );

        this.name = ko.pureComputed(
            () => {
                let { name } = config();
                if (!name) {
                    return '';
                }

                return {
                    text: name,
                    href: { route: 'func', params: { func: name } }
                };
            }
        );

        this.version = ko.pureComputed(
            () => config().version || '$LATEST'
        );

        this.description = ko.pureComputed(
            () => config().description || ''
        );

        this.codeSize = ko.pureComputed(
            () => config().code_size || 0
        );

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

        this.deleteButton = {
            subject: 'func',
            tooltip: 'delete func function',
            onDelete: () => deleteFunc(config().name, config().version)
        };

    }
}
