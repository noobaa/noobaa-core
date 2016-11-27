import template from './capacity-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize } from 'utils/all';
import style from 'style';

const bgColor = style['color7'];
const emptyColor = style['color7'];

class CapacityBarViewModel extends Disposable {
    constructor({ total, used, color = style['color8'] }) {
        super();

        let summedUsed = ko.pureComputed(
            () => {
                let naked = ko.unwrap(used);
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

        this.values = [
            {
                value: summedUsed,
                color: color
            },
            {
                value: ko.pureComputed(
                    () => ko.unwrap(total) - summedUsed()
                ),
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
