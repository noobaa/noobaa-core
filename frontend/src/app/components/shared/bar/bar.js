/* Copyright (C) 2016 NooBaa */

import template from './bar.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import { isFunction, echo, clamp } from 'utils/core-utils';

const defaultEmptyColor = style['color15'];
const teethColor = style['color7'];
const limitsColor = style['color7'];
const markersTextColor = style['white'];
const markersBorderColor = style['white'];
const markersBackgroundColor = style['color1'];
const fontSize = style['font-size1'];

const defaultMinRatio = .03;
const markersMargin = 8;
const markersHeight = Math.ceil(parseInt(fontSize) * 1.5 + markersMargin);
const font = `${fontSize} ${style['font-family1']}`;

class BarViewModel extends BaseViewModel {
    constructor({
        values = [],
        height = 2,
        width,
        teeth = 0,
        limits = false,
        markers,
        emptyColor = defaultEmptyColor,
        minRatio = defaultMinRatio,

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
        this.teeth  = teeth;
        this.limits = limits;
        this.markers = markers;
        this.barHeight = height;
        this.minRatio = minRatio;
        this.formatter = isFunction(limits) ? limits : echo;

        this.canvasWidth = width;
        this.canvasHeight = ko.pureComputed(
            () => {
                const markers = ko.unwrap(this.markers);
                const markersLine = limits || (markers && markers.length > 0);
                return ko.unwrap(height) +
                    2 * ko.unwrap(teeth) +
                    (markersLine ?  markersHeight : 0);
            }
        );

        this.barOffset = ko.pureComputed(
            () => {
                const limits = ko.unwrap(this.limits);
                const markers = ko.unwrap(this.markers);
                return limits || (markers && markers.length > 0) ? markersHeight : 0;
            }
        );
    }

    draw(ctx, { width }) {
        const hasValues = (ko.unwrap(this.values) || []).length > 0;

        this._drawBar(ctx, width);

        if (hasValues && ko.unwrap(this.limits)) {
            this._drawLimits(ctx, width, 0);
        }

        if (hasValues && ko.unwrap(this.markers)) {
            this._drawMarkers(ctx, width);
        }
    }

    _drawBar(ctx, width ) {
        const teeth = ko.unwrap(this.teeth);
        const values = ko.deepUnwrap(this.values);
        const total = this.total();
        const minRatio = ko.unwrap(this.minRatio);
        const barOffset = this.barOffset();
        const barHeight = ko.unwrap(this.barHeight);

        ctx.fillStyle = ko.unwrap(this.emptyColor);
        ctx.fillRect(0, barOffset + teeth, width, barHeight);

        let offset = 0;
        for (const { value, color } of values) {
            if (value === 0) continue;
            const ratio = Math.max(value / total, minRatio);

            ctx.fillStyle = color;
            ctx.fillRect(
                Math.round(offset),
                barOffset + teeth,
                Math.round(ratio * width),
                barHeight
            );

            if (teeth) {
                ctx.fillStyle = teethColor;
                ctx.fillRect(Math.round(offset), barOffset, 1, barHeight + 2 * teeth);
            }

            offset += ratio * width;
        }

        if (values.length && teeth) {
            ctx.fillStyle = teethColor;
            ctx.fillRect(Math.round(offset) - 1 , barOffset, 1, barHeight + 2 * teeth);
        }
    }

    _drawLimits(ctx, width) {
        const formatter = this.formatter;

        ctx.textBaseline = 'top';
        ctx.font = font;
        ctx.fillStyle = limitsColor;
        ctx.textAlign = 'left';
        ctx.fillText(formatter(0), 0, 2);
        ctx.textAlign = 'right';
        ctx.fillText(formatter(this.total()), width, 2);
    }

    _drawMarkers(ctx, width) {
        const total = this.total();
        const markers = ko.unwrap(this.markers);

        for (const { placement, label } of markers) {
            const offset = Math.floor(clamp(ko.unwrap(placement) / total, 0, 1) * width);

            const boxWidth = ctx.measureText(ko.unwrap(label)).width + 8;
            const boxHeight = markersHeight - markersMargin;
            const x = Math.floor(clamp(offset - boxWidth / 2, 0, width - boxWidth));

            ctx.textBaseline = 'top';
            ctx.font = font;
            ctx.fillStyle = markersBackgroundColor;
            ctx.strokeStyle = markersBorderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, 1);
            ctx.lineTo(x, boxHeight);
            ctx.lineTo(Math.max(offset - 4, 0), boxHeight);
            ctx.lineTo(offset, boxHeight + 4);
            ctx.lineTo(Math.min(offset + 4, width), boxHeight);
            ctx.lineTo(x + boxWidth, boxHeight);
            ctx.lineTo(x + boxWidth, 1);
            ctx.lineTo(x, 1);
            ctx.fill();
            ctx.stroke();
            ctx.closePath();
            ctx.textAlign = 'left';
            ctx.fillStyle = markersTextColor;
            ctx.fillText(ko.unwrap(label), x + 4, 2);
        }
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
