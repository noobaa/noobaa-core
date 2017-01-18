import template from './capacity-bar.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { isArray } from 'utils/core-utils';
import { sumSize, formatSize, toBytes } from 'utils/size-utils';
import style from 'style';

const minUsedRatio = .03;
const bgColor = style['color7'];
const emptyColor = style['color7'];
const color = style['color8'];
// const lowCapacityColor = style['color11'];
// const noCapacityColor = style['color10'];

class CapacityBarViewModel extends BaseViewModel {
    constructor({ total, used }) {
        super();

        const sum = ko.pureComputed(
            () => {
                const usedNaked = ko.deepUnwrap(used);
                if (isArray(usedNaked)) {
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

        const usedColor = ko.pureComputed(
            () => color
            // () => {
            //     const free = toBytes(ko.unwrap(total) - toBytes(ko.un)
            //     if () <
            // }
            // toBytes(sum()) > Math.pow(1024, 2) ?
            //     (usedRatio() > .8 ? color : lowCapacityColor) :
            //     noCapacityColor
        );

        this.values = [
            {
                value: usedRatio,
                color: usedColor
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
                if (!isArray(usedNaked)) {
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
