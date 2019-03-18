/* Copyright (C) 2016 NooBaa */
import style from 'style';
import themes from 'themes';
import { rgbToColor, colorToRgb } from 'utils/color-utils';

const gutter = parseInt(style['gutter']);

export default function(themeName) {
    const theme = themes[themeName];

    return {
        // Defualt settings that apply to all chart types.
        global: {
            responsive: true,
            aspectRatio: 4,
            maintainAspectRatio: true,
            legend: {
                display: false
            },
            tooltips: {
                backgroundColor: colorToRgb(
                    ...rgbToColor(theme.color13),
                    .8
                ),
                position: 'nearest',
                multiKeyBackground: 'transparent',
                caretSize: 7,
                cornerRadius: gutter / 4,
                xPadding: gutter / 2,
                yPadding: gutter / 2,
                titleFontFamily: style['font-family1'],
                titleFonrStyle: 'normal',
                titleFontColor: theme.color02,
                titleFontSize: parseInt(style['font-size2']),
                titleMarginBottom: gutter / 2,
                bodyFontFamily: style['font-family1'],
                bodyFontColor: theme.color02,
                bodyFontSize: parseInt(style['font-size1']),
                bodySpacing: gutter / 2
            }
        },

        // Defualt settings that apply to the scales for all chart types.
        scale: {
            gridLines: {
                color: theme.color07,
                zeroLineColor: theme.color07,
                drawBorder: false
            },
            ticks: {
                fontSize: 10,
                fontColor: theme.color11,
                fontFamily: style['font-family1'],
                min: 0
            },
            scaleLabel: {
                fontSize: 11,
                fontColor: theme.color17,
                fontFamily: style['font-family1']
            },
            maxBarThickness: gutter * 3
        },

        // Defualt settings for all charts of bar type.
        bar: {
            tooltips: {
                intersect: false
            },
            scales: {
                xAxes: [{
                    gridLines: {
                        display: false
                    },
                    ticks: {
                        fontColor: theme.color17
                    }
                }]
            }
        },

        // Defualt settings for all charts of line type.
        line: {
            tooltips: {
                mode: 'index'
            }
        }
    };
}
