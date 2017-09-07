/* Copyright (C) 2016 NooBaa */

import template from './capacity-bar.html';
import ko from 'knockout';
import { sumSize, formatSize, toBytes } from 'utils/size-utils';
import style from 'style';

const minUsedRatio = .03;
const bgColor = style['color7'];
const emptyColor = style['color7'];
const color = style['color8'];

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

                return (sumInBytes > 0 && totalInBytes > 0) ?
                    Math.max(minUsedRatio, sumInBytes / totalInBytes) :
                    0;
            }
        );

        this.values = [
            {
                value: usedRatio,
                color: color
            },
            {
                value: ko.pureComputed(
                    () => 1 - usedRatio()
                ),
                color: bgColor
            }
        ];

        this.emptyColor = emptyColor;

        this.tooltip = ko.pureComputed(
            () => {
                const usedNaked = ko.deepUnwrap(used);
                if (!Array.isArray(usedNaked)) {
                    return;
                }

                return usedNaked.map(
                    ({ label, value }) => `${label}: ${formatSize(value)}`
                );
            }
        );
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
