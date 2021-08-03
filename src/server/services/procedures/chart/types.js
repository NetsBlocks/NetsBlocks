const types = require('../../input-types');

const LineTypes = [
    'lines',
    'points',
    'linespoints',
    'impulses',
    'dots',
    'steps',
    'fsteps',
    'boxes',
    // The following gnuplot types are unsupported:
    // histeps, errorbars, labels, xerrorbars, yerrorbars,
    // xyerrorbars, errorlines, xerrorlines, yerrorlines, xyerrorlines,
    // histograms, filledcurves, boxerrorbars, boxxyerrorbars, financebars,
    // candlesticks, vectors, image, rgbimage, pm3d
    // For more info, check out http://www.gnuplot.info/docs_4.2/node145.html
];

module.exports = function registerTypes() {
    types.defineType({
        name: 'LineType',
        description: 'The style of line to use for Chart plots.',
        baseType: 'Enum',
        baseParams: LineTypes
    });
};
