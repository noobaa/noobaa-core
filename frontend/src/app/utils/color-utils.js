/* Copyright (C) 2016 NooBaa */

import { isDefined } from './core-utils';
import { pad } from './string-utils';

export function colorToHex(r, g, b) {
    return `#${
        pad(r.toString(16), 2)
    }${
        pad(g.toString(16), 2)
    }${
        pad(b.toString(16), 2)
    }`;
}

export function colorToRgb(r, g, b, alpha) {
    return isDefined(alpha) ?
        `rgba(${r},${g},${b},${alpha})` :
        `rgb(${r},${g},${b})`;
}

export function hexToColor(hex) {
    const regExp = /#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/;
    const [, ...channels] = hex.match(regExp).map(
        hex => parseInt(hex, 16)
    );

    return channels;
}

export function hexToRgb(hex, alpha) {
    return colorToRgb(...hexToColor(hex), alpha);
}

export function tweenColors(ratio, ...colors){
    if (colors.length === 1) {
        return colors[0];
    }

    let scaledRatio = ratio * (colors.length - 1);
    let lowerBound = Math.floor(scaledRatio);
    let upperBound = Math.ceil(scaledRatio);
    let tweenValue = scaledRatio - lowerBound;

    let [r1, g1, b1] = hexToColor(colors[lowerBound]);
    let [r2, g2, b2] = hexToColor(colors[upperBound]);

    let r = ((r1 + (r2 - r1) * tweenValue) | 0);
    let g = ((g1 + (g2 - g1) * tweenValue) | 0);
    let b = ((b1 + (b2 - b1) * tweenValue) | 0);

    return colorToHex(r,g,b);
}
