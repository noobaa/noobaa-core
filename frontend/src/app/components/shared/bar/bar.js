import template from './bar.html';
import ko from 'knockout';
import style from 'style';

class BarViewModel {
    constructor({ values = [], bgColor = style['bg-color3'] }) {
        this.values = values;
        this.bgColor = bgColor;

        console.log(this.bgColor);
    }

    draw(ctx, { width, height }) {
        let values = ko.unwrap(this.values);

        // Clear the bar.
        ctx.fillStyle = ko.unwrap(this.bgColor);
        ctx.fillRect(0, 0, width, height);

        // Draw the sections.
        values.reduce(
            (pos, item) => {
                let w = item.value * width + .5 | 0;
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
