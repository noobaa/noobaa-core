import template from './capacity-bar.html';
import ko from 'knockout';
import { isDefined, formatSize } from 'utils';
import style from 'style';

class CapacityBarViewModel {
    constructor({ total, used }) {
        let free = ko.pureComputed(
            () => ko.unwrap(total) - ko.unwrap(used)
        );

        this.totalText = ko.pureComputed(
            () => {
                let val = ko.unwrap(total);
                return isDefined(val) ? formatSize(val) : 'N/A'
            }
        );

        this.usedText = ko.pureComputed(
            () => {
                let val = ko.unwrap(used);
                return isDefined(val) ? formatSize(val) : 'N/A'
            }
        );

        let usedWithMin = ko.pureComputed(
            () => {
                let val = ko.unwrap(used);
                return val > 0  ?
                    Math.max(ko.unwrap(used), ko.unwrap(total) / 50) :
                    0;
            }
        );

        this.values = [
            { value: usedWithMin, color: style['bg-color11'] },
            { value: free, color: style['bg-color3'] }
        ];
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template,
}