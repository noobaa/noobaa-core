import template from './capacity-bar.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { isArray } from 'utils/core-utils';
import { formatSize, sizeToBytes } from 'utils/size-utils';
import style from 'style';

const minUsedRatio = .03;
const bgColor = style['color7'];
const emptyColor = style['color7'];

class CapacityBarViewModel extends BaseViewModel {
    constructor({ total, used, color = style['color8'] }) {
        super();

        const noramlized = ko.pureComputed(
            () => ko.deepUnwrap(used)
        );

        const sum = ko.pureComputed(
            () => {
                const used = noramlized();
                if (isArray(used)) {
                    return used.reduce(
                        (sum, { value }) => sum + sizeToBytes(value),
                        0
                    );
                } else {
                    return sizeToBytes(used);
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
                const totalNaked = sizeToBytes(ko.unwrap(total) || 0);
                const sumNaked = sum();

                return (sumNaked > 0 && totalNaked > 0) ?
                    Math.max(minUsedRatio, sumNaked / totalNaked) :
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
            () => !isArray(noramlized()) ?
                '' :
                noramlized().map(
                    ({ label, value }) => `${label}: ${formatSize(value)}`
                )
        );
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
