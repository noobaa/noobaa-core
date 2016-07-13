import template from './slider.html';
import Disposable from 'disposable';
import ko from 'knockout';

class SliderViewModel extends Disposable {
    constructor({ current = 1 }) {
        super();

        this.current = current;

        this.transform = ko.pureComputed(
            () => `translate(${
                (ko.unwrap(this.current) - 1) * -100
            }%)`
        );
    }

    isCurrent(index) {
        return ko.unwrap(this.current()) === index() + 1;
    }
}

export default {
    viewModel: SliderViewModel,
    template: template
};
