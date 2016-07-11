import template from './bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

class BarViewModel extends Disposable {
    constructor({ values = [], bgColor = style['bg-color4'] }) {
        super();

        this.values = values;
        this.bgColor = bgColor;
    }

    draw(ctx, { width, height }) {
        let values = ko.unwrap(this.values);

        // Clear the bar.
        ctx.fillStyle = ko.unwrap(this.bgColor);
        ctx.fillRect(0, 0, width, height);

        // Draw the sections.
        values.reduce(
            (pos, item) => {
                let w = ko.unwrap(item.value) * width + .5 | 0;
                ctx.fillStyle = ko.unwrap(item.color);
                ctx.fillRect(pos, 0, w, height);
                return pos + w;
            },
            0
        );
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
