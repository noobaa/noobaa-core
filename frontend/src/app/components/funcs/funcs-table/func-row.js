/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { deleteFunc } from 'actions';


export default class FuncRowViewModel extends BaseViewModel {
    constructor(func) {
        super();

        const _func = ko.pureComputed(
            () => func() || {}
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
                const { name } = _func();
                if (!name) {
                    return '';
                }

                return {
                    text: name,
                    tooltip: {
                        text: name,
                        breakWords: true
                    },
                    href: { route: 'func', params: { func: name } }
                };
            }
        );

        this.version = ko.pureComputed(
            () => _func().version || ''
        );

        const config = ko.pureComputed(
            () => _func().config || {}
        );

        this.description = ko.pureComputed(
            () => {
                const text = config().description || '';
                return text ? { text, tooltip: text } : '';
            }
        );

        this.codeSize = ko.pureComputed(
            () => formatSize(config().code_size || 0)
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
            onDelete: () => {
                return deleteFunc(this.name().text, this.version());
            }
        };

    }
}
