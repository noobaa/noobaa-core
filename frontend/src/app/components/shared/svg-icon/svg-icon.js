import template from './svg-icon.html';
import ko from 'knockout';
import { defaultIconFile } from 'config.json';

class SVGIconViewModel {
    constructor({ name, base = defaultIconFile, fill, stroke }) {
        this.href = ko.pureComputed(
            () => `${ko.unwrap(base)}#${ko.unwrap(name)}`
        );
        this.fill = fill;
        this.stroke = stroke;
    }
}

export default {
    viewModel: SVGIconViewModel,
    template: template
};
