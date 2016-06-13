import template from './capacity-bar.html';
import ko from 'knockout';
import { isDefined, formatSize } from 'utils';
import style from 'style';

const minUsedRatio = .03;

class CapacityBarViewModel {
    constructor({ total, used }) {
        this.totalText = ko.pureComputed(
            () => {
                let val = ko.unwrap(total);
                return isDefined(val) ? formatSize(val) : 'N/A';
            }
        );

        this.usedText = ko.pureComputed(
            () => {
                let val = ko.unwrap(used);
                return isDefined(val) ? formatSize(val) : 'N/A';
            }
        );

        let usedRatio = ko.pureComputed(
            () => {
                let ratio = ko.unwrap(total) > 0 ? ko.unwrap(used) / ko.unwrap(total) : 0;
                return ratio > 0 ? Math.max(ratio, minUsedRatio) : 0;
            }
        );

        this.values = [
            { value: usedRatio, color: style['bg-color11'] }
        ];
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
