import template from './progress-bar.html'
import ko from 'knockout';
import numeral from 'numeral';

class ProgressBarViewModel {
    constructor({ progress = 0 }) {

        this.progress = ko.pureComputed(
            () => numeral(ko.unwrap(progress)).format('0%')
        )
    }
}

export default {
    viewModel: ProgressBarViewModel,
    template: template
};