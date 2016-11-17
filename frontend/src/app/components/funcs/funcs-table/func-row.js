import Disposable from 'disposable';
import ko from 'knockout';
import { stringifyAmount } from 'utils';
import { deleteFunc } from 'actions';


export default class FuncRowViewModel extends Disposable {
    constructor(func) {
        super();

        this.state = ko.pureComputed(
            () => func() ? {
                name: 'healthy',
                css: 'success',
                tooltip: 'Healthy'
            } : {}
        );

        this.name = ko.pureComputed(
            () => {
                if (!func()) {
                    return {};
                }

                let { name } = func().config;
                return {
                    text: name,
                    href: { route: 'func', params: { func: name } }
                };
            }
        );

        this.version = ko.pureComputed(
            () => func() && func().config.version
        );

        this.description = ko.pureComputed(
            () => func() && func().config.description
        );

        this.codeSize = ko.pureComputed(
            () => func() && func().config.code_size
        );

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

        this.deleteButton = {
            subject: 'func',
            tooltip: 'delete func function',
            onDelete: () => deleteFunc(func().config)
        };

    }
}
