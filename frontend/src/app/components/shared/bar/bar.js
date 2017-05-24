/* Copyright (C) 2016 NooBaa */

import template from './bar.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import { echo } from 'utils/core-utils';

const defaultEmptyColor = style['color15'];
const labelsColor = style['color7'];
const defaultMinRatio = .03;
const seperatorWidth = 1;
const font = `${style['font-size1']} ${style['font-family1']}`;

class BarViewModel extends BaseViewModel {
    constructor({
        values = [],
        height = 2,
        width,
        drawLabels = false,
        labelFormatter = echo,
        emptyColor = defaultEmptyColor,
        minRatio = defaultMinRatio
    }) {
        super();

        this.total = ko.pureComputed(
            () => ko.deepUnwrap(values).reduce(
                (sum, entry) => sum + entry.value,
                0
            )
        );

        this.emptyColor = emptyColor;
        this.values = values;
        this.drawLabels = drawLabels;
        this.labelFormatter = labelFormatter;
        this.barHeight = height;
        this.minRatio = minRatio;

        this.barOffset = ko.pureComputed(
            () => ko.unwrap(drawLabels) ? 16 : 0
        );

        this.canvasWidth = width;
        this.canvasHeight = ko.pureComputed(
            () => this.barOffset() + ko.unwrap(height) + 6
        );
    }

    draw(ctx, { width }) {
        const values = ko.deepUnwrap(this.values);
        const total = this.total();
        const drawLabels = ko.unwrap(this.drawLabels);
        const formatter = this.labelFormatter;
        const barHeight = ko.unwrap(this.barHeight);
        const minRatio = ko.unwrap(this.minRatio);
        const y = this.barOffset() + 3;

        // Draw the line background.
        ctx.textBaseline = 'top';
        ctx.font = font;
        ctx.fillStyle = ko.unwrap(this.emptyColor);
        ctx.fillRect(0, y, width, barHeight);

        // Draw the parts.
        let offset = 0;
        let sum = 0;
        for (const { value, color } of values) {
            if (value === 0) continue;
            const ratio = Math.max(value / total, minRatio);

            ctx.fillStyle = color;
            ctx.fillRect(Math.round(offset), y, Math.round(ratio * width), barHeight);

            if (drawLabels) {
                ctx.fillStyle = labelsColor;
                ctx.fillRect(Math.round(offset), y - 3, seperatorWidth, barHeight + 6);
                ctx.textAlign = offset === 0 ? 'left' : 'center';
                ctx.fillText(formatter(sum), offset, 0);
            }

            offset += ratio * width;
            sum += value;
        }

        // Draw the end scale.
        if (values.length && drawLabels) {
            ctx.fillStyle = labelsColor;
            ctx.fillRect(width - seperatorWidth, y - 3, seperatorWidth, barHeight + 6);
            ctx.textAlign = 'right';
            ctx.fillText(formatter(sum), offset, 0);
        }
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
