import template from './svg-icon.html';
import ko from 'knockout';
import { realizeUri } from 'utils';
import { asset as assetsRoute } from 'routes';
import { defaultIconFile } from 'config.json';

class SVGIconViewModel {
    constructor({ name, asset = defaultIconFile, fill, stroke }) {
        this.href = ko.pureComputed(
            () => `${
                realizeUri(assetsRoute, { asset: ko.unwrap(asset) })
            }#${
                ko.unwrap(name)
            }`
        );
        this.fill = fill;
        this.stroke = stroke;

    }
}

export default {
    viewModel: SVGIconViewModel,
    template: template
};
