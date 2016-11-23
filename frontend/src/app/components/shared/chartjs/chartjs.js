import './chartjs-binding';
import template from './chartjs.html';
import Disposable from 'disposable';
import ko from 'knockout';

class chartJSViewModel extends Disposable{
    constructor({ type = 'line', data = {}, options = {} }) {
        super();

        this.config = ko.pureComputed(
            () => ({
                type: ko.unwrap(type),
                options: ko.unwrap(options),
                data: ko.unwrap(data)
            })
        );
    }
}

export default {
    viewModel: chartJSViewModel,
    template: template
};
