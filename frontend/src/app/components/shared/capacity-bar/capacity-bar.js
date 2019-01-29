/* Copyright (C) 2016 NooBaa */

import template from './capacity-bar.html';
import ko from 'knockout';
import { sumSize, formatSize, toBytes } from 'utils/size-utils';

class CapacityBarViewModel {
    constructor({ total, used }) {
        const sum = ko.pureComputed(
            () => {
                const usedNaked = ko.deepUnwrap(used);
                if (Array.isArray(usedNaked)) {
                    const sizeList = usedNaked.map( ({ value }) => value );
                    return sumSize(...sizeList);
                } else {
                    return usedNaked;
                }
            }
        );

        this.usedText = sum.extend({
            formatSize: true
        });

        this.totalText = ko.pureComputed(
            () => ko.unwrap(total)
        ).extend({
            formatSize: true
        });

        const usedRatio = ko.pureComputed(
            () => {
                const totalInBytes = toBytes(ko.unwrap(total) || 0);
                const sumInBytes = toBytes(sum());
                return totalInBytes > 0 ? sumInBytes / totalInBytes : 0;
            }
        );

        this.values = [
            {
                value: usedRatio,
                color: 'rgb(var(--color6)'
            },
            {
                value: ko.pureComputed(
                    () => 1 - usedRatio()
                ),
                color: 'rgb(var(--color16)'
            }
        ];

        this.tooltip = ko.pureComputed(
            () => {
                const usedNaked = ko.deepUnwrap(used);
                if (!Array.isArray(usedNaked)) {
                    return;
                }

                return {
                    template: 'propertySheet',
                    text: usedNaked.map(({ label, value }) => ({
                        label,
                        value: formatSize(value)
                    }))
                };
            }
        );
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
