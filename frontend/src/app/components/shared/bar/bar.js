/* Copyright (C) 2016 NooBaa */

import template from './bar.html';
import ko from 'knockout';
import { normalizeValues, sumBy, clamp } from 'utils/core-utils';
import { getFormatter } from 'utils/chart-utils';

function _asPercentage(val) {
    return `${val * 100}%`;
}

function _getMarkerStyle(pos) {
    return {
        left: pos <= .5 ? _asPercentage(pos) : 'auto',
        right: pos > .5 ? _asPercentage(1 - pos) : 'auto',
        transform: `translateX(${Math.sign(pos - .5) * 50}%)`
    };
}

class LineViewModel {
    x1 = ko.observable();
    x2 = ko.observable();
    stroke = ko.observable();
}

class MarkerViewModel {
    text = ko.observable();
    style = {
        left: ko.observable(),
        right: ko.observable(),
        transform: ko.observable()
    }
}

class BarViewModel {
    sub = null;

    limits = {
        visible: ko.observable(),
        low: ko.observable(),
        high: ko.observable()
    };

    lines = ko.observableArray()
        .ofType(LineViewModel);

    markers = ko.observableArray()
        .ofType(MarkerViewModel);

    isEmpty = ko.observable();

    constructor(params) {
        this.sub = ko.computed(() =>
            this.onParams(ko.deepUnwrap(params))
        );
    }

    onParams(params) {
        const {
            values: items = [],
            markers: _markers = [],
            limits: showLimits = false,
            spacing = 0,
            minRatio = .03,
            format = 'none'
        } = params;

        const values = items.map(item => item.value);
        const nonZeroCount = sumBy(values, value => value ? 1 : 0);
        const spacingFactor = 1 - (spacing * Math.max(nonZeroCount - 1, 0)); // need to exclude zero items;
        const ratios = normalizeValues(values, 1, minRatio);

        let offset = 0;
        const segments = items.map((item, i) => {
            const len = ratios[i] * spacingFactor;
            const start = offset;
            const end = offset + len;
            const color = item.color;
            if (len > 0) offset += len + spacing;

            return { start, end, color  };
        });

        const lines = segments.map(seg => ({
            x1: _asPercentage(seg.start),
            x2: _asPercentage(seg.end),
            stroke: seg.color
        }));

        const sum = sumBy(values);
        const isEmpty = sum === 0;
        const formatter = getFormatter(format);

        const limits = {
            visible: Boolean(showLimits),
            low: formatter(0),
            high: formatter(sum)
        };

        const markers = _markers
            .filter(marker => marker.visible !== false)
            .map(marker => {
                const i = clamp(marker.position || 0, 0, segments.length);
                const pos =
                    (i === segments.length && 1) ||
                    (i > 0 && (segments[i - 1].end + segments[i].start) / 2) ||
                    0;

                return {
                    text: marker.text,
                    style: _getMarkerStyle(pos)
                };
            });

        ko.assignToProps(this, {
            lines,
            isEmpty,
            markers,
            limits
        });

    }

    dispose() {
        this.sub && this.sub.dispose();
    }
}

export default {
    viewModel: BarViewModel,
    template: template
};
