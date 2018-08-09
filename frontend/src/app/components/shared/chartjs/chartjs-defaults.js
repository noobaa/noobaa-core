/* Copyright (C) 2016 NooBaa */
import style from 'style';
import { deepFreeze } from 'utils/core-utils';
import { hexToRgb } from 'utils/color-utils';

const gutter = parseInt(style['gutter']);

export default deepFreeze({
    // Defualt settings that apply to all chart types.
    global: {
        responsive: true,
        aspectRatio: 4,
        maintainAspectRatio: true,
        legend: {
            display: false
        },
        tooltips: {
            backgroundColor: hexToRgb(style['color5'], .85),
            position: 'nearest',
            multiKeyBackground: 'transparent',
            caretSize: 7,
            cornerRadius: gutter / 4,
            xPadding: gutter / 2,
            yPadding: gutter / 2,
            titleFontFamily: style['font-family1'],
            titleFonrStyle: 'normal',
            titleFontColor: style['color6'],
            titleFontSize: parseInt(style['font-size2']),
            titleMarginBottom: gutter / 2,
            bodyFontFamily: style['font-family1'],
            bodyFontColor: style['color7'],
            bodyFontSize: parseInt(style['font-size1']),
            bodySpacing: gutter / 2
        }
    },

    // Defualt settings that apply to the scales for all chart types.
    scale: {
        gridLines: {
            color: style['color15'],
            zeroLineColor: style['color15'],
            drawBorder: false
        },
        ticks: {
            fontSize: 10,
            fontColor: style['color7'],
            fontFamily: style['font-family1'],
            min: 0
        },
        scaleLabel: {
            fontSize: 11,
            fontColor: style['color6'],
            fontFamily: style['font-family1']
        },
        maxBarThickness: gutter * 3
    },

    // Defualt settings for all charts of bar type.
    bar: {
        tooltips: {
            intersect: false
        }
    },

    // Defualt settings for all charts of line type.
    line: {
        tooltips: {
            mode: 'index'
        }
    }
});
