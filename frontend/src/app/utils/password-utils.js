/* Copyright (C) 2016 NooBaa */

import { last, clamp } from './core-utils';
import { symbols, letters, isDigit, isLetter,
    isUpperCase, isLowerCase } from './string-utils';


export function calcPasswordStrength(password) {
    if (!password) {
        return 0;
    }

    let charsInfo = Array.from(password).map(
        char => {
            let digit = isDigit(char);
            let letter = isLetter(char);
            let symbol = !digit && !letter;
            let upperCase = isUpperCase(char);
            let lowerCase = isLowerCase(char);
            let place = !letter ?
                (symbol ? symbols.indexOf(char) : Number(char)) :
                letters.indexOf(char.toLowerCase());


            return { digit, letter, symbol, upperCase, lowerCase, place };
        }
    );

    let counts = charsInfo.reduce(
        (counts, charInfo) => {
            counts.upperCase += charInfo.upperCase && charInfo.letter ? 1 : 0;
            counts.lowerCase += charInfo.lowerCase && charInfo.letter ? 1 : 0;
            counts.symbol += charInfo.symbol ? 1 : 0;
            counts.digit += charInfo.digit ? 1 : 0;
            counts.letter += charInfo.letter ? 1 : 0;
            return counts;
        },
        {
            upperCase: 0,
            lowerCase: 0,
            symbol: 0,
            digit: 0,
            letter: 0
        }
    );

    let score = 0;

    //  Number of Characters : +(n*4)
    score += charsInfo.length * 4;

    // Uppercase Letters : +((len-n)*2)
    score += counts.upperCase ?
        (charsInfo.length - counts.upperCase) * 2 :
        0;

    // Lowercase Letters : +((len-n)*2)
    score += counts.lowerCase ?
        (charsInfo.length - counts.lowerCase) * 2 :
        0;

    // Numbers : +(n*4)
    score += counts.digit * 4;

    // Symbols : +(n*6)
    score += counts.symbol * 6;

    // Middle Numbers or Symbols : +(n*2)
    score += (counts.digit + counts.symbol) * 2;
    score -= charsInfo[0].digit || charsInfo[0].symbol ? 2 : 0;
    score -= last(charsInfo).digit || last(charsInfo).symbol ? 2 : 0;

    // Requirements : +(n*2)
    // Minimum 8 characters in length
    // Contains 3/4 of the following items:
    // - Uppercase Letters
    // - Lowercase Letters
    // - Numbers
    // - Symbols
    let checkedRequirements = 0;
    checkedRequirements += Number(counts.digit > 0) + Number(counts.upperCase > 0) +
        Number(counts.lowerCase > 0) + Number(counts.symbol > 0);
    if (checkedRequirements >=3 && charsInfo.length >= 8)
        score += (checkedRequirements + 1) * 2;

    //Letters Only : -n
    score -= charsInfo.length === counts.letter ? counts.letter : 0;

    // Numbers Only : -n
    score -= charsInfo.length === counts.digit ? counts.digit : 0;

    // Consecutive Uppercase Letters  : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.letter && currInfo.upperCase &&
                lastChar.letter && lastChar.upperCase) * 2;
        },
        0
    );

    // Consecutive Lowercase Letters : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.letter && currInfo.lowerCase &&
                lastChar.letter && lastChar.lowerCase) * 2;
        },
        0
    );

    // Consecutive Numbers : -(n*2)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 1) return inc;

            let lastChar = charsInfo[i - 1];
            return inc + Number(currInfo.digit && lastChar.digit) * 2;
        },
        0
    );

    // Sequential Letters (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if (!last2.letter || !last1.letter || !currInfo.letter) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );

    // Sequential Numbers (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if (!last2.digit || !last1.digit || !currInfo.digit) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );
    // Sequential Symbols (3+) : -(n*3)
    score -= charsInfo.reduce(
        (inc, currInfo, i) => {
            if (i < 2) return inc;

            let last1 = charsInfo[i - 1];
            let last2 = charsInfo[i - 2];
            if (!last2.symbol || !last1.symbol || !currInfo.symbol) {
                return inc;
            }

            let diff = last2.place - last1.place;
            let diff2 = last1.place - currInfo.place;
            let delta = (Math.abs(diff) === 1 && diff === diff2) ? 3 : 0;
            return inc + delta;
        },
        0
    );
    // Repeat Characters (Case Insensitive)
    let uniquesCount = password.length;
    score -= Array.from(password).reduce(
        (inc, char, i) => {
            let delta = 0;

            let j = password.indexOf(char);
            while (j > -1) {
                if (j !== i) {
                    delta += password.length / Math.abs(j - i);
                }

                j = password.indexOf(char, j + 1);
            }

            if (delta > 0) {
                inc += delta;

                if (--uniquesCount) {
                    inc /= uniquesCount;
                }
            }

            return Math.ceil(inc);
        },
        0
    );

    return clamp(score/100, 0, 1);
}
