import template from './capacity-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { formatSize } from 'utils';
import style from 'style';

class CapacityBarViewModel extends Disposable {
    constructor({ total, usedNoobaa, usedOther }) {
        super();

        let used = ko.pureComputed(
            () => ko.unwrap(usedNoobaa) + ko.unwrap(usedOther)
        );

        let free = ko.pureComputed(
            () => ko.unwrap(total) - used()
        );

        this.values = [
            {
                value: usedNoobaa,
                color: style['bg-color11']
            },
            {
                value: usedOther,
                color: style['bg-color11']
            },
            {
                value: free,
                color: style['bg-color4']
            }
        ];

        this.usedText = ko.pureComputed(
            () => formatSize(used())
        );

        this.totalText = ko.pureComputed(
            ()=> formatSize(ko.unwrap(total))
        );

        this.tooltip = ko.pureComputed(
            () => `
                Used (Noobaa): ${formatSize(ko.unwrap(usedNoobaa))} <br>
                Used (Other): ${formatSize(ko.unwrap(usedOther))}
            `
        );
    }
}

export default {
    viewModel: CapacityBarViewModel,
    template: template
};
