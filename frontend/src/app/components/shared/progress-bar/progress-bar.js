import template from './progress-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

class ProgressBarViewModel extends Disposable {
    constructor({ progress = 0 }) {

        super();

        this.progress = ko.pureComputed(
            () => numeral(ko.unwrap(progress)).format('0%')
        );
    }
}

export default {
    viewModel: ProgressBarViewModel,
    template: template
};
