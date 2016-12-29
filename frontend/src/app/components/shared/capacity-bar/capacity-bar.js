import template from './capacity-bar.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { formatSize } from 'utils/size-utils';
import style from 'style';

const minUsedRatio = .03;
const bgColor = style['color7'];
const emptyColor = style['color7'];

class CapacityBarViewModel extends BaseViewModel {
    constructor({ total, used, color = style['color8'] }) {
        super();

        const summedUsed = ko.pureComputed(
            () => {
                const naked = ko.unwrap(used);
                if (naked instanceof Array) {
                    return naked.reduce(
                        (sum, entry) => sum + ko.unwrap(entry.value),
                        0
                    );
                } else {
                    return naked;
                }
            }
        );

        this.usedText = summedUsed.extend({
            formatSize: true
        });

        this.totalText = ko.pureComputed(
            () => ko.unwrap(total)
        ).extend({
            formatSize: true
        });

        const usedRatio = ko.pureComputed(
            () => {
                const totalNaked = ko.unwrap(total());
                const usedNaked = summedUsed();
                if (totalNaked === 0 || usedNaked === 0) {
                    return 0;
                }

                return Math.max(minUsedRatio, usedNaked / totalNaked);
            }
        );

        this.values = [
            {
                value: usedRatio,
                color: color
            },
            {
                value: ko.pureComputed( () => 1 - usedRatio() ),
                color: bgColor
            }
        ];

        this.emptyColor = emptyColor;

        this.tooltip = ko.pureComputed(
            () => {
                let naked = ko.unwrap(used);
                if (naked instanceof Array) {
                    return naked.map(
                        ({label, value}) => `${
                            label
                        }: ${
                            ko.unwrap(value) ? formatSize(ko.unwrap(value)) : 'N/A'
                        }`
                    );
                } else {
                    return '';
                }
            }
        );
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
