import './chartjs-binding';
import template from './chartjs.html';
import Disposable from 'disposable';

class chartJSViewModel extends Disposable{
    constructor({ type = 'line', data = {}, options = {} }) {
        super();
        this.config = { type, options, data };
    }
}

export default {
    viewModel: chartJSViewModel,
    template: template
};
