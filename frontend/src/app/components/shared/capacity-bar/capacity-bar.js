import template from './capacity-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize, isDefined } from 'utils';
import style from 'style';

const bgColor = style['gray-lv4'];

class CapacityBarViewModel extends Disposable {
    constructor({ total, used, color = style['blue-mid'] }) {
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

        this.usedText = ko.pureComputed(
            () => isDefined(summedUsed()) ? formatSize(summedUsed()) : 'N/A'
        );

        this.totalText = ko.pureComputed(
            () => isDefined(ko.unwrap(total)) ? formatSize(ko.unwrap(total)) : 'N/A'
        );

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
